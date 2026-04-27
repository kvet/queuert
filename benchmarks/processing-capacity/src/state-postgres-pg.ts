import { createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPgPoolStateProvider } from "example-state-postgres-pg/provider";
import { Pool } from "pg";

import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — POSTGRESQL (pg)");

const concurrency = parseConcurrency();

console.log("\nStarting PostgreSQL container...");
const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();

const pool = new Pool({ connectionString: pgContainer.getConnectionUri(), max: 20 });
const stateProvider = createPgPoolStateProvider({ pool });

const stateAdapter = await createPgStateAdapter({ stateProvider, schema: "public" });
await stateAdapter.migrateToLatest();
console.log("PostgreSQL ready.");

await runBenchmark({
  stateAdapter,
  withTransaction: stateProvider.withTransaction,
  concurrency,
});

await pool.end();
await pgContainer.stop();
