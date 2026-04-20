import { createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createInProcessNotifyAdapter } from "queuert";
import { createAsyncLock } from "queuert/internal";

import { createSqliteStateProvider } from "./sqlite-state-provider.js";
import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — SQLITE");

const concurrency = parseConcurrency();

const db = new Database(":memory:");
db.pragma("journal_mode = WAL");
db.pragma("auto_vacuum = INCREMENTAL");
db.pragma("foreign_keys = ON");

const stateProvider = createSqliteStateProvider({ db, lock: createAsyncLock() });
const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
console.log("SQLite ready (in-memory).");

await runBenchmark({
  stateAdapter,
  notifyAdapter: await createInProcessNotifyAdapter(),
  withTransaction: stateProvider.withTransaction,
  concurrency,
});

db.close();
