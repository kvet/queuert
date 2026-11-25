import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { createPostgresJsStateProvider } from "example-postgresql-state-postgres-js/provider";
import postgres from "postgres";
import { createClient, createWorkerRunner, createProcessors, defineJobTypes } from "queuert";

import { createPostgresJsNotifyProvider } from "./provider.ts";

console.log("Starting PostgreSQL...");
await using pg = await acquirePostgres("postgres:18", import.meta.url);

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
const stateSql = drivers.adopt(postgres(pg.connectionString, { max: 10 }), async (sql) =>
  sql.end(),
);
await using stateAdapter = createPgStateAdapter({
  stateProvider: createPostgresJsStateProvider({ sql: stateSql }),
});
await stateAdapter.migrateToLatest();
// #endhide

const sql = drivers.adopt(postgres(pg.connectionString, { max: 10 }), async (sql) => sql.end());

const notifyProvider = createPostgresJsNotifyProvider({ sql });

await using notifyAdapter = createPgNotifyAdapter({ notifyProvider });
// #endregion

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
        attemptHandler: async ({ job, applyJobOutcome }) => {
          console.log(`Generating ${job.input.reportType} report...`);
          await new Promise((r) => setTimeout(r, 500));
          const rowCount = Math.floor(Math.random() * 1000) + 100;
          console.log(`Report generated with ${rowCount} rows`);
          await stateAdapter.withTransaction(async (ctx) =>
            applyJobOutcome({
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

await workerRunner.start();

console.log("Requesting sales report...");
const chain = await stateAdapter.withTransaction(async (ctx) =>
  client.createChain({
    ...ctx,
    typeName: "generate_report",
    input: { reportType: "sales", dateRange: { from: "2024-01-01", to: "2024-12-31" } },
  }),
);

console.log("Report queued! Continuing with other work...");
console.log("Preparing email template...");
await new Promise((resolve) => setTimeout(resolve, 100));
console.log("Loading recipient list...");
await new Promise((resolve) => setTimeout(resolve, 100));

console.log("Waiting for report...");
const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Report ready! ID: ${result.output.reportId}, Rows: ${result.output.rowCount}`);

console.log("Done!");
