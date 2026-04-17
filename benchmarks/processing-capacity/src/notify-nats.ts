import { createNatsNotifyAdapter } from "@queuert/nats";
import { createSqliteStateAdapter } from "@queuert/sqlite";
import { NatsContainer } from "@testcontainers/nats";
import Database from "better-sqlite3";
import { connect } from "nats";
import { createAsyncLock } from "queuert/internal";

import { createSqliteStateProvider } from "./sqlite-state-provider.js";
import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — NATS NOTIFY");

const concurrency = parseConcurrency();

const db = new Database(":memory:");
db.pragma("journal_mode = WAL");
db.pragma("auto_vacuum = INCREMENTAL");
db.pragma("foreign_keys = ON");

const stateProvider = createSqliteStateProvider({ db, lock: createAsyncLock() });
const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

console.log("\nStarting NATS container...");
const natsContainer = await new NatsContainer("nats:2.10").withExposedPorts(4222).start();

const nc = await connect(natsContainer.getConnectionOptions());
const notifyAdapter = await createNatsNotifyAdapter({ nc, subjectPrefix: "queuert_bench" });
console.log("SQLite + NATS ready.");

await runBenchmark({
  stateAdapter,
  notifyAdapter,
  withTransaction: stateProvider.withTransaction,
  concurrency,
});

await nc.close();
await natsContainer.stop();
db.close();
