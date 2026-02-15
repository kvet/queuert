/**
 * PostgreSQL Notify Adapter Memory Measurement
 */

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { type PgNotifyProvider, createPgNotifyAdapter } from "@queuert/postgres";
import { createInProcessStateAdapter } from "queuert/internal";
import { createClient, createInProcessWorker } from "queuert";
import {
  diffMemory,
  measureBaseline,
  measureMemory,
  printHeader,
  printSummary,
  registry,
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

const subscriptions = new Map<string, { unlisten: () => Promise<void> }>();

const notifyProvider: PgNotifyProvider = {
  publish: async (channel, message) => {
    await sql.notify(channel, message);
  },
  subscribe: async (channel, onMessage) => {
    const subscription = await sql.listen(channel, (payload) => {
      onMessage(payload);
    });
    subscriptions.set(channel, subscription);
    return async () => {
      await subscription.unlisten();
      subscriptions.delete(channel);
    };
  },
};

const stateAdapter = createInProcessStateAdapter();
const [beforeAdapter, afterAdapter, notifyAdapter] = await measureMemory(async () =>
  createPgNotifyAdapter({ provider: notifyProvider }),
);
console.log("\nAfter creating PgNotifyAdapter:");
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
      stateAdapter.runInTransaction(async (ctx) =>
        qrtClient.startJobChain({
          ...ctx,
          typeName: "test-job",
          input: { message: `Test message ${i}` },
        }),
      ),
    );
    promises.push(qrtClient.waitForJobChainCompletion(chain, { timeoutMs: 5000 }));
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
