import { createPgNotifyAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPgPoolNotifyProvider } from "example-notify-postgres-pg/provider";
import { Pool } from "pg";
import { createInProcessStateAdapter } from "queuert";

import { runBenchmark } from "./utils.js";

console.log("\nStarting PostgreSQL container...");
const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();

const pool = new Pool({ connectionString: pgContainer.getConnectionUri(), max: 20 });
console.log("PostgreSQL (notify) ready.");

await runBenchmark({
  title: "PROCESSING CAPACITY — PG NOTIFY (pg)",
  stateAdapter: await createInProcessStateAdapter(),
  notifyAdapter: await createPgNotifyAdapter({
    notifyProvider: createPgPoolNotifyProvider({ pool }),
  }),
});

await pool.end();
await pgContainer.stop();
