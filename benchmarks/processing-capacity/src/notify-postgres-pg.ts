import { createPgNotifyAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPgPoolNotifyProvider } from "example-notify-postgres-pg/provider";
import { Pool } from "pg";
import { createInProcessStateAdapter } from "queuert";

import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — PG NOTIFY (pg)");

const concurrency = parseConcurrency();

const stateAdapter = await createInProcessStateAdapter();

console.log("\nStarting PostgreSQL container...");
const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();

const pool = new Pool({ connectionString: pgContainer.getConnectionUri(), max: 20 });
const notifyProvider = createPgPoolNotifyProvider({ pool });
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
await pool.end();
await pgContainer.stop();
