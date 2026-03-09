import { createSqliteStateAdapter } from "@queuert/sqlite";
import { createNatsNotifyAdapter } from "@queuert/nats";
import { NatsContainer } from "@testcontainers/nats";
import Database from "better-sqlite3";
import { connect } from "nats";
import { createSqliteStateProvider } from "./sqlite-state-provider.js";
import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — NATS NOTIFY");

const concurrency = parseConcurrency();

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

const stateProvider = createSqliteStateProvider(db);
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
  runInTransaction: stateProvider.runInTransaction,
  concurrency,
});

await nc.close();
await natsContainer.stop();
db.close();
