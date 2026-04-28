import { DatabaseSync } from "node:sqlite";

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import { createNodeSqliteStateProvider } from "example-state-sqlite-node/provider";

import { runBenchmark } from "./utils.js";

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA auto_vacuum = INCREMENTAL");
db.exec("PRAGMA foreign_keys = ON");

const stateProvider = createNodeSqliteStateProvider({ db, lock: createAsyncRwLock() });
const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
console.log("SQLite ready (in-memory).");

await runBenchmark({
  title: "PROCESSING CAPACITY — SQLITE (node:sqlite)",
  stateAdapter,
});

db.close();
