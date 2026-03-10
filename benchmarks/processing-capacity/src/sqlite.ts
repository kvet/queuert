import { createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { createSqliteStateProvider } from "./sqlite-state-provider.js";
import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — SQLITE");

const concurrency = parseConcurrency();

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

const stateProvider = createSqliteStateProvider(db);
const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
console.log("SQLite ready (in-memory).");

await runBenchmark({
  stateAdapter,
  notifyAdapter: createInProcessNotifyAdapter(),
  runInTransaction: stateProvider.runInTransaction,
  concurrency,
});

db.close();
