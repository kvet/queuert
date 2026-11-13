import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { createPgPoolStateProvider } from "example-state-postgres-pg/provider";
import { Pool } from "pg";
import { createClient, createWorkerRunner, createProcessors, defineJobTypes } from "queuert";

import { createPgPoolNotifyProvider } from "./provider.ts";

// Start PostgreSQL using testcontainers
console.log("Starting PostgreSQL...");
await using pg = await acquirePostgres("postgres:18", import.meta.url);

// Define job types
const jobTypes = defineJobTypes<{
  generate_report: {
    entry: true;
    input: { reportType: string; dateRange: { from: string; to: string } };
    output: { reportId: string; rowCount: number };
  };
}>();

// #region setup
await using drivers = new AsyncDisposableStack();
// #hide
// Create the state adapter
const statePool = drivers.adopt(
  new Pool({ connectionString: pg.connectionString, max: 10 }),
  async (pool) => pool.end(),
);
await using stateAdapter = createPgStateAdapter({
  stateProvider: createPgPoolStateProvider({ pool: statePool }),
});
await stateAdapter.migrateToLatest();
// #endhide

// Create PostgreSQL connection pool
const pool = drivers.adopt(
  new Pool({ connectionString: pg.connectionString, max: 10 }),
  async (pool) => pool.end(),
);

// Create the notify provider using pg
const notifyProvider = createPgPoolNotifyProvider({ pool });

// Create the notify adapter
await using notifyAdapter = createPgNotifyAdapter({ notifyProvider });
// #endregion

// Create client and worker runner
const client = createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      generate_report: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Generating ${job.input.reportType} report...`);
          // Simulate report generation work
          await new Promise((r) => setTimeout(r, 500));
          const rowCount = Math.floor(Math.random() * 1000) + 100;
          console.log(`Report generated with ${rowCount} rows`);
          return stateAdapter.withTransaction(async (ctx) =>
            complete({
              ...ctx,
              output: {
                reportId: `RPT-${Date.now()}`,
                rowCount,
              },
            }),
          );
        },
      },
    },
  }),
});

// Start worker runner and queue a job
await workerRunner.start();

console.log("Requesting sales report...");
const chain = await stateAdapter.withTransaction(async (ctx) =>
  client.createChain({
    ...ctx,
    typeName: "generate_report",
    input: { reportType: "sales", dateRange: { from: "2024-01-01", to: "2024-12-31" } },
  }),
);

// Main thread continues with other work while job processes
console.log("Report queued! Continuing with other work...");
console.log("Preparing email template...");
await new Promise((resolve) => setTimeout(resolve, 100));
console.log("Loading recipient list...");
await new Promise((resolve) => setTimeout(resolve, 100));

// Now wait for the report to be ready
console.log("Waiting for report...");
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Report ready! ID: ${result.output.reportId}, Rows: ${result.output.rowCount}`);

console.log("Done!");
