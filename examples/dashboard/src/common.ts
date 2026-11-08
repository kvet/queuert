import { join } from "node:path";

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import { createClient } from "queuert";

import { createIdGenerator, jobTypes } from "./scenarios.ts";

export const db = new Database(join(import.meta.dirname, "..", "data.db"));
db.pragma("journal_mode = WAL");
const lock = createAsyncRwLock();
const stateProvider = createBetterSqlite3StateProvider({ db, lock });

const generateId = createIdGenerator(1);
export const stateAdapter = createSqliteStateAdapter({
  stateProvider,
  generateJobId: generateId,
  generateWorkerId: generateId,
});
await stateAdapter.migrateToLatest();

export const withTransaction = async <T>(
  fn: (ctx: { db: typeof db }) => Promise<T>,
): Promise<T> => {
  using _h = await lock.acquireWrite();
  db.exec("BEGIN");
  try {
    const result = await fn({ db });
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
};

export const client = createClient({ stateAdapter, jobTypes });
