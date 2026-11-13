import { createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";

import { noopSyncNotifyAdapter, runSyncBenchmark } from "./utils.ts";

const db = new Database(":memory:");

const stateProvider = createBetterSqlite3StateProvider({ db });
const stateAdapter = createSqliteStateAdapter({ stateProvider });
stateAdapter.migrateToLatest();
console.log("SQLite ready (in-memory).");

await runSyncBenchmark({
  title: "PROCESSING CAPACITY — SQLITE (better-sqlite3)",
  stateAdapter,
  notifyAdapter: noopSyncNotifyAdapter,
});

db.close();
