/**
 * PostgreSQL State Adapter Memory Measurement
 */

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { type PgStateProvider, createPgStateAdapter } from "@queuert/postgres";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { createClient, createInProcessWorker } from "queuert";
import {
  diffMemory,
  measureBaseline,
  measureMemory,
  printHeader,
  printSummary,
  registry,
} from "./utils.js";

printHeader("POSTGRESQL STATE ADAPTER");

const baseline = await measureBaseline();

console.log("\nStarting PostgreSQL container...");
const [beforeContainer, afterContainer, pgContainer] = await measureMemory(async () =>
  new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start(),
);
console.log("\nAfter starting container (testcontainers overhead):");
diffMemory(beforeContainer, afterContainer);

const [beforeConnection, afterConnection, sql] = await measureMemory(async () =>
  postgres(pgContainer.getConnectionUri(), { max: 10 }),
);
console.log("\nAfter creating postgres.js connection:");
diffMemory(beforeConnection, afterConnection);

type DbContext = { sql: typeof sql };
const stateProvider: PgStateProvider<DbContext> = {
  runInTransaction: async (cb) => {
    let result: unknown;
    await sql.begin(async (txSql) => {
      result = await cb({ sql: txSql as unknown as typeof sql });
    });
    return result as never;
  },
  executeSql: async ({ txContext, sql: query, params }) => {
    const sqlClient = txContext?.sql ?? sql;
    const normalizedParams = params ? params.map((p) => (p === undefined ? null : p)) : [];
    const result = await sqlClient.unsafe(query, normalizedParams as never[]);
    return result as Record<string, unknown>[];
  },
};

const notifyAdapter = createInProcessNotifyAdapter();
const [beforeAdapter, afterAdapter, stateAdapter] = await measureMemory(async () => {
  const stateAdapter = await createPgStateAdapter({ stateProvider, schema: "public" });
  await stateAdapter.migrateToLatest();
  return stateAdapter;
});
console.log("\nAfter creating PgStateAdapter (with migrations):");
diffMemory(beforeAdapter, afterAdapter);

const [beforeSetup, afterSetup, { qrtClient, stopWorker }] = await measureMemory(async () => {
  const qrtClient = await createClient({
    stateAdapter,
    notifyAdapter,
    registry,
  });

  const qrtWorker = await createInProcessWorker({
    stateAdapter,
    notifyAdapter,
    registry,
    processors: {
      "test-job": {
        attemptHandler: async ({ complete }) => complete(async () => ({ processed: true })),
      },
    },
  });

  const stopWorker = await qrtWorker.start();
  return { qrtClient, stopWorker };
});
console.log("\nAfter creating client + worker:");
diffMemory(beforeSetup, afterSetup);

console.log("\nProcessing 100 jobs...");
const [beforeProcessing, afterProcessing] = await measureMemory(async () => {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    const chain = await qrtClient.withNotify(async () =>
      stateProvider.runInTransaction(async (ctx) =>
        qrtClient.startJobChain({
          ...ctx,
          typeName: "test-job",
          input: { message: `Test message ${i}` },
        }),
      ),
    );
    promises.push(qrtClient.waitForJobChainCompletion(chain, { timeoutMs: 30000 }));
  }
  await Promise.all(promises);
});
console.log("\nAfter processing 100 jobs:");
diffMemory(beforeProcessing, afterProcessing);

await stopWorker();
await sql.end();
await pgContainer.stop();

const [, afterCleanup] = await measureMemory(async () => {});
console.log("\nAfter cleanup (delta from baseline):");
diffMemory(baseline, afterCleanup);

printSummary([
  ["Container + driver:", afterConnection.heapUsed - baseline.heapUsed],
  ["State adapter:", afterAdapter.heapUsed - beforeAdapter.heapUsed],
  ["Client + worker:", afterSetup.heapUsed - beforeSetup.heapUsed],
]);
