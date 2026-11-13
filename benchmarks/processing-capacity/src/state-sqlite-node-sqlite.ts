import { DatabaseSync } from "node:sqlite";

import { createSqliteStateAdapter } from "@queuert/sqlite";
import { createNodeSqliteStateProvider } from "example-state-sqlite-node-sqlite/provider";

import { noopSyncNotifyAdapter, runSyncBenchmark } from "./utils.ts";

const db = new DatabaseSync(":memory:");

const stateProvider = createNodeSqliteStateProvider({ db });
const stateAdapter = createSqliteStateAdapter({ stateProvider });
stateAdapter.migrateToLatest();
console.log("SQLite ready (in-memory).");

await runSyncBenchmark({
  title: "PROCESSING CAPACITY — SQLITE (node:sqlite)",
  stateAdapter,
  notifyAdapter: noopSyncNotifyAdapter,
});

db.close();
