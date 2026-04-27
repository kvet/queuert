import { createPgNotifyAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import postgres from "postgres";
import { createInProcessStateAdapter } from "queuert";

import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — PG NOTIFY (postgres-js)");

const concurrency = parseConcurrency();

const stateAdapter = await createInProcessStateAdapter();

console.log("\nStarting PostgreSQL container...");
const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();

const sql = postgres(pgContainer.getConnectionUri(), { max: 20 });
const notifyProvider = createPostgresJsNotifyProvider({ sql });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });
console.log("PostgreSQL (notify) ready.");

await runBenchmark({
  stateAdapter,
  notifyAdapter,
  withTransaction: stateAdapter.withTransaction,
  concurrency,
});

await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
await pgContainer.stop();
