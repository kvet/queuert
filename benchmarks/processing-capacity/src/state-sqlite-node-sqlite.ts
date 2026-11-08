import { DatabaseSync } from "node:sqlite";

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import { createNodeSqliteStateProvider } from "example-state-sqlite-node-sqlite/provider";

import { noopNotifyAdapter, runBenchmark } from "./utils.ts";

const db = new DatabaseSync(":memory:");

const stateProvider = createNodeSqliteStateProvider({ db, lock: createAsyncRwLock() });
const stateAdapter = createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
console.log("SQLite ready (in-memory).");

await runBenchmark({
  title: "PROCESSING CAPACITY — SQLITE (node:sqlite)",
  stateAdapter,
  notifyAdapter: noopNotifyAdapter,
});

db.close();
