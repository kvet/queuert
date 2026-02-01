/**
 * SQLite State Adapter Memory Measurement
 */

import Database from "better-sqlite3";
import {
  type SqliteStateProvider,
  createAsyncLock,
  createSqliteStateAdapter,
} from "@queuert/sqlite";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { createQueuertClient, createQueuertInProcessWorker } from "queuert";
import {
  diffMemory,
  measureBaseline,
  measureMemory,
  printHeader,
  printSummary,
  registry,
} from "./utils.js";

printHeader("SQLITE STATE ADAPTER");

const baseline = await measureBaseline();

type DbContext = { db: Database.Database };

const [beforeDb, afterDb, db] = await measureMemory(async () => {
  const db = new Database(":memory:");
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
  executeSql: async ({ txContext, sql, params, returns }) => {
    const database = txContext?.db ?? db;
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
  const qrtClient = await createQueuertClient({
    stateAdapter,
    notifyAdapter,
    log: () => {},
    registry,
  });

  const qrtWorker = await createQueuertInProcessWorker({
    stateAdapter,
    notifyAdapter,
    log: () => {},
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
    promises.push(qrtClient.waitForJobChainCompletion(chain, { timeoutMs: 5000 }));
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
