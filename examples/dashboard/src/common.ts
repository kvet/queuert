import { join } from "node:path";

import { createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import { createClient } from "queuert";

import { createIdGenerator, jobTypes } from "./scenarios.ts";

export const db = new Database(join(import.meta.dirname, "..", "data.db"));
db.pragma("journal_mode = WAL");
const stateProvider = createBetterSqlite3StateProvider({ db });

const generateId = createIdGenerator(1);
export const stateAdapter = createSqliteStateAdapter({
  stateProvider,
  generateJobId: generateId,
  generateWorkerId: generateId,
});
stateAdapter.migrateToLatest();

export const withTransaction = <T>(fn: (ctx: { db: typeof db }) => T): T =>
  db.transaction(() => fn({ db }))();

export const client = createClient({ stateAdapter, jobTypes });
