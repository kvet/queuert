import { join } from "node:path";

import { createAsyncRwLock } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";

const DB_PATH = join(import.meta.dirname, "..", "data.db");

export const createDatabase = (): Database.Database => {
  const db = new Database(DB_PATH);
  db.pragma("auto_vacuum = INCREMENTAL");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
};

export const createStateProvider = (db: Database.Database) => {
  const lock = createAsyncRwLock();
  return createBetterSqlite3StateProvider({ db, lock });
};
