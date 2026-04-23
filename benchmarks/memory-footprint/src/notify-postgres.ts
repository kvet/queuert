/**
 * PostgreSQL Notify Adapter Memory Measurement
 */

import { createPgNotifyAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import postgres from "postgres";
import {
  createClient,
  createInProcessStateAdapter,
  createInProcessWorker,
  createProcessors,
  withTransactionHooks,
} from "queuert";

import {
  diffMemory,
  jobTypes,
  measureBaseline,
  measureMemory,
  printHeader,
  printSummary,
} from "./utils.js";

printHeader("POSTGRESQL NOTIFY ADAPTER");

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

const notifyProvider = createPostgresJsNotifyProvider({ sql });

const stateAdapter = await createInProcessStateAdapter();
const [beforeAdapter, afterAdapter, notifyAdapter] = await measureMemory(async () =>
  createPgNotifyAdapter({ notifyProvider }),
);
console.log("\nAfter creating PgNotifyAdapter:");
diffMemory(beforeAdapter, afterAdapter);

const [beforeSetup, afterSetup, { client, stopWorker }] = await measureMemory(async () => {
  const client = await createClient({
    stateAdapter,
    notifyAdapter,
    jobTypes,
  });

  const worker = await createInProcessWorker({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        "test-job": {
          attemptHandler: async ({ complete }) => complete(async () => ({ processed: true })),
        },
      },
    }),
  });

  const stopWorker = await worker.start();
  return { client, stopWorker };
});
console.log("\nAfter creating client + worker:");
diffMemory(beforeSetup, afterSetup);

console.log("\nProcessing 100 jobs...");
const [beforeProcessing, afterProcessing] = await measureMemory(async () => {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (ctx) =>
        client.startJobChain({
          ...ctx,
          transactionHooks,
          typeName: "test-job",
          input: { message: `Test message ${i}` },
        }),
      ),
    );
    promises.push(client.awaitJobChain(jobChain, { timeoutMs: 5000 }));
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
  ["Notify adapter:", afterAdapter.heapUsed - beforeAdapter.heapUsed],
  ["Client + worker:", afterSetup.heapUsed - beforeSetup.heapUsed],
]);
