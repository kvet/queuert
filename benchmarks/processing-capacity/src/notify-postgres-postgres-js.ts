import { createPgNotifyAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import postgres from "postgres";
import { createInProcessStateAdapter } from "queuert";

import { runBenchmark } from "./utils.js";

console.log("\nStarting PostgreSQL container...");
const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();

const sql = postgres(pgContainer.getConnectionUri(), { max: 20 });
console.log("PostgreSQL (notify) ready.");

await runBenchmark({
  title: "PROCESSING CAPACITY — PG NOTIFY (postgres-js)",
  stateAdapter: await createInProcessStateAdapter(),
  notifyAdapter: await createPgNotifyAdapter({
    notifyProvider: createPostgresJsNotifyProvider({ sql }),
  }),
});

await sql.end();
await pgContainer.stop();
