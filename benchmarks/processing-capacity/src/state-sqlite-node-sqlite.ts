import { DatabaseSync } from "node:sqlite";

import { createSyncSqliteStateAdapter } from "@queuert/sqlite";
import { createNodeSqliteStateProvider } from "example-state-sqlite-node-sqlite/provider";

import { runBenchmark } from "./utils.js";

const db = new DatabaseSync(":memory:");

const stateProvider = createNodeSqliteStateProvider({ db });
const stateAdapter = createSyncSqliteStateAdapter({ stateProvider });
stateAdapter.migrateToLatest();
console.log("SQLite ready (in-memory).");

await runBenchmark({
  title: "PROCESSING CAPACITY — SQLITE (node:sqlite)",
  stateAdapter,
});

db.close();
