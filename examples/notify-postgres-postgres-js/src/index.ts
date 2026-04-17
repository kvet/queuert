import { createPgNotifyAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import {
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
} from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";

import { createPostgresJsNotifyProvider } from "./provider.js";

// 1. Start PostgreSQL using testcontainers
console.log("Starting PostgreSQL...");
const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();

// 2. Create postgres-js connection
const sql = postgres(pgContainer.getConnectionUri(), { max: 10 });

// 3. Create the notify provider using postgres-js
const notifyProvider = createPostgresJsNotifyProvider({ sql });

// 4. Define job types
const jobTypeRegistry = defineJobTypeRegistry<{
  generate_report: {
    entry: true;
    input: { reportType: string; dateRange: { from: string; to: string } };
    output: { reportId: string; rowCount: number };
  };
}>();

// 5. Create adapters
const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = await createPgNotifyAdapter({ provider: notifyProvider });

// 6. Create client and worker
const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypeRegistry,
});

const qrtWorker = await createInProcessWorker({
  client: qrtClient,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
    client: qrtClient,
    jobTypeRegistry,
    processors: {
      generate_report: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Generating ${job.input.reportType} report...`);
          // Simulate report generation work
          await new Promise((resolve) => setTimeout(resolve, 500));
          const rowCount = Math.floor(Math.random() * 1000) + 100;
          console.log(`Report generated with ${rowCount} rows`);
          return complete(async () => ({
            reportId: `RPT-${Date.now()}`,
            rowCount,
          }));
        },
      },
    },
  }),
});

// 7. Start worker and queue a job
const stopWorker = await qrtWorker.start();

console.log("Requesting sales report...");
const jobChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    qrtClient.startJobChain({
      ...ctx,
      transactionHooks,
      typeName: "generate_report",
      input: { reportType: "sales", dateRange: { from: "2024-01-01", to: "2024-12-31" } },
    }),
  ),
);

// 8. Main thread continues with other work while job processes
console.log("Report queued! Continuing with other work...");
console.log("Preparing email template...");
await new Promise((resolve) => setTimeout(resolve, 100));
console.log("Loading recipient list...");
await new Promise((resolve) => setTimeout(resolve, 100));

// 9. Now wait for the report to be ready
console.log("Waiting for report...");
const result = await qrtClient.awaitJobChain(jobChain, { timeoutMs: 5000 });
console.log(`Report ready! ID: ${result.output.reportId}, Rows: ${result.output.rowCount}`);

// 10. Cleanup
await stopWorker();
await sql.end();
await pgContainer.stop();
console.log("Done!");
