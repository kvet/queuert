import { createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";

import { runBenchmark } from "./utils.js";

console.log("\nStarting PostgreSQL container...");
const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();

const sql = postgres(pgContainer.getConnectionUri(), { max: 20 });
const stateProvider = createPostgresJsStateProvider({ sql });

const stateAdapter = await createPgStateAdapter({ stateProvider, schema: "public" });
await stateAdapter.migrateToLatest();
console.log("PostgreSQL ready.");

await runBenchmark({
  title: "PROCESSING CAPACITY — POSTGRESQL (postgres-js)",
  stateAdapter,
});

await sql.end();
await pgContainer.stop();
