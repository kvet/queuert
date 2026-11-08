import { createPgNotifyAdapter } from "@queuert/postgres";
import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import { acquirePostgres } from "@queuert/testcontainers";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import postgres from "postgres";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createPostgresJsNotifyProvider } from "./provider.ts";

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

// Create the state adapter
const db = new Database(":memory:");
const stateAdapter = createSqliteStateAdapter({
  stateProvider: createBetterSqlite3StateProvider({ db, lock: createAsyncRwLock() }),
});
await stateAdapter.migrateToLatest();

// #region setup
// Create postgres-js connection
const sql = postgres(pg.connectionString, { max: 10 });

// Create the notify provider using postgres-js
const notifyProvider = createPostgresJsNotifyProvider({ sql });

// Create the notify adapter
const notifyAdapter = createPgNotifyAdapter({ notifyProvider });
// #endregion

// Create client and worker runner
const client = createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

const workerRunner = createWorkerRunner({
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
          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
                output: {
                  reportId: `RPT-${Date.now()}`,
                  rowCount,
                },
              }),
            ),
          );
        },
      },
    },
  }),
});

// Start worker runner and queue a job
const stopWorkerRunner = await workerRunner.start();

console.log("Requesting sales report...");
const chain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      txHooks,
      typeName: "generate_report",
      input: { reportType: "sales", dateRange: { from: "2024-01-01", to: "2024-12-31" } },
    }),
  ),
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

// Cleanup
await stopWorkerRunner();
await stateAdapter.close();
db.close();
// #region cleanup
await notifyAdapter.close();
await sql.end();
// #endregion
console.log("Done!");
