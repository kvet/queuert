import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPgPoolNotifyProvider } from "example-notify-postgres-pg/provider";
import { createPgPoolStateProvider } from "example-state-postgres-pg/provider";
import { Pool } from "pg";

import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — PG NOTIFY");

const concurrency = parseConcurrency();

console.log("\nStarting PostgreSQL container...");
const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();

const pool = new Pool({ connectionString: pgContainer.getConnectionUri(), max: 20 });
const stateProvider = createPgPoolStateProvider({ pool });

const stateAdapter = await createPgStateAdapter({ stateProvider, schema: "public" });
await stateAdapter.migrateToLatest();

const notifyProvider = createPgPoolNotifyProvider({ pool });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });
console.log("PostgreSQL (state + notify) ready.");

await runBenchmark({
  stateAdapter,
  notifyAdapter,
  withTransaction: stateProvider.withTransaction,
  concurrency,
});

await notifyProvider.close();
await pool.end();
await pgContainer.stop();
