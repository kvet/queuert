/**
 * SQLite State Adapter Memory Measurement
 */

import {
  type SqliteStateProvider,
  createAsyncLock,
  createSqliteStateAdapter,
} from "@queuert/sqlite";
import Database from "better-sqlite3";
import {
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  withTransactionHooks,
} from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

import {
  diffMemory,
  jobTypeRegistry,
  measureBaseline,
  measureMemory,
  printHeader,
  printSummary,
} from "./utils.js";

printHeader("SQLITE STATE ADAPTER");

const baseline = await measureBaseline();

type DbContext = { db: Database.Database };

const [beforeDb, afterDb, db] = await measureMemory(async () => {
  const db = new Database(":memory:");
  db.pragma("auto_vacuum = INCREMENTAL");
  db.pragma("foreign_keys = ON");
  return db;
});
console.log("\nAfter creating better-sqlite3 database:");
diffMemory(beforeDb, afterDb);

const lock = createAsyncLock();

const stateProvider: SqliteStateProvider<DbContext> = {
  runInTransaction: async (fn) => {
    await lock.acquire();
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn({ db });
        db.exec("COMMIT");
        return result;
      } catch (error) {
        if (db.inTransaction) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // ignore rollback errors
          }
        }
        throw error;
      }
    } finally {
      lock.release();
    }
  },
  executeSql: async ({ txCtx, sql, params, returns }) => {
    const database = txCtx?.db ?? db;
    if (returns) {
      const stmt = database.prepare(sql);
      return stmt.all(...(params ?? [])) as Record<string, unknown>[];
    } else {
      if (params && params.length > 0) {
        const stmt = database.prepare(sql);
        stmt.run(...params);
      } else {
        database.exec(sql);
      }
      return [];
    }
  },
};

const notifyAdapter = createInProcessNotifyAdapter();
const [beforeAdapter, afterAdapter, stateAdapter] = await measureMemory(async () => {
  const stateAdapter = await createSqliteStateAdapter({ stateProvider });
  await stateAdapter.migrateToLatest();
  return stateAdapter;
});
console.log("\nAfter creating SqliteStateAdapter (with migrations):");
diffMemory(beforeAdapter, afterAdapter);

const [beforeSetup, afterSetup, { qrtClient, stopWorker }] = await measureMemory(async () => {
  const qrtClient = await createClient({
    stateAdapter,
    notifyAdapter,
    jobTypeRegistry,
  });

  const qrtWorker = await createInProcessWorker({
    client: qrtClient,
    jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
      client: qrtClient,
      jobTypeRegistry,
      processors: {
        "test-job": {
          attemptHandler: async ({ complete }) => complete(async () => ({ processed: true })),
        },
      },
    }),
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
    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      stateProvider.runInTransaction(async (ctx) =>
        qrtClient.startJobChain({
          ...ctx,
          transactionHooks,
          typeName: "test-job",
          input: { message: `Test message ${i}` },
        }),
      ),
    );
    promises.push(qrtClient.awaitJobChain(jobChain, { timeoutMs: 5000 }));
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
