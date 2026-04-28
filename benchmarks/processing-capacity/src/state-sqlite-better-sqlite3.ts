import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";

import { runBenchmark } from "./utils.js";

const db = new Database(":memory:");
db.pragma("journal_mode = WAL");
db.pragma("auto_vacuum = INCREMENTAL");
db.pragma("foreign_keys = ON");

const stateProvider = createBetterSqlite3StateProvider({ db, lock: createAsyncRwLock() });
const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
console.log("SQLite ready (in-memory).");

await runBenchmark({
  title: "PROCESSING CAPACITY — SQLITE (better-sqlite3)",
  stateAdapter,
});

db.close();
