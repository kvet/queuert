import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";

import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — SQLITE (better-sqlite3)");

const concurrency = parseConcurrency();

const db = new Database(":memory:");
db.pragma("journal_mode = WAL");
db.pragma("auto_vacuum = INCREMENTAL");
db.pragma("foreign_keys = ON");

const stateProvider = createBetterSqlite3StateProvider({ db, lock: createAsyncRwLock() });
const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
console.log("SQLite ready (in-memory).");

await runBenchmark({
  stateAdapter,
  withTransaction: stateProvider.withTransaction,
  concurrency,
});

db.close();
