/**
 * SQLite State Adapter Memory Measurement
 */

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import {
  createClient,
  createInProcessNotifyAdapter,
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

printHeader("SQLITE STATE ADAPTER");

const baseline = await measureBaseline();

const [beforeDb, afterDb, db] = await measureMemory(async () => {
  const db = new Database(":memory:");
  db.pragma("auto_vacuum = INCREMENTAL");
  db.pragma("foreign_keys = ON");
  return db;
});
console.log("\nAfter creating better-sqlite3 database:");
diffMemory(beforeDb, afterDb);

const stateProvider = createBetterSqlite3StateProvider({ db, lock: createAsyncRwLock() });

const notifyAdapter = await createInProcessNotifyAdapter();
const [beforeAdapter, afterAdapter, stateAdapter] = await measureMemory(async () => {
  const stateAdapter = await createSqliteStateAdapter({ stateProvider });
  await stateAdapter.migrateToLatest();
  return stateAdapter;
});
console.log("\nAfter creating SqliteStateAdapter (with migrations):");
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
      stateProvider.withTransaction(async (ctx) =>
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
db.close();

const [, afterCleanup] = await measureMemory(async () => {});
console.log("\nAfter cleanup (delta from baseline):");
diffMemory(baseline, afterCleanup);

printSummary([
  ["SQLite driver:", afterDb.heapUsed - beforeDb.heapUsed],
  ["State adapter:", afterAdapter.heapUsed - beforeAdapter.heapUsed],
  ["Client + worker:", afterSetup.heapUsed - beforeSetup.heapUsed],
]);
