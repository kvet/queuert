import { type PgNotifyProvider, createPgNotifyAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import {
  createConsoleLog,
  createQueuertClient,
  createQueuertInProcessWorker,
  defineJobTypes,
} from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";

// 1. Start PostgreSQL using testcontainers
console.log("Starting PostgreSQL...");
const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();

// 2. Create postgres-js connection
// postgres-js manages a dedicated connection for LISTEN automatically
const sql = postgres(pgContainer.getConnectionUri(), { max: 10 });

// 3. Create the notify provider using postgres-js
// postgres-js has built-in support for LISTEN/NOTIFY via sql.listen() and sql.notify()
const subscriptions = new Map<string, { unlisten: () => Promise<void> }>();

const notifyProvider: PgNotifyProvider = {
  publish: async (channel, message) => {
    await sql.notify(channel, message);
  },
  subscribe: async (channel, onMessage) => {
    // sql.listen returns a ListenMeta object with an unlisten method
    const subscription = await sql.listen(channel, (payload) => {
      onMessage(payload);
    });
    subscriptions.set(channel, subscription);
    return async () => {
      await subscription.unlisten();
      subscriptions.delete(channel);
    };
  },
};

// 4. Define job types
const registry = defineJobTypes<{
  generate_report: {
    entry: true;
    input: { reportType: string; dateRange: { from: string; to: string } };
    output: { reportId: string; rowCount: number };
  };
}>();

// 5. Create adapters
const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = await createPgNotifyAdapter({ provider: notifyProvider });
const log = createConsoleLog();

// 6. Create client and worker
const qrtClient = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  log,
  registry,
});

const qrtWorker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
  registry,
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
});

// 7. Start worker and queue a job
const stopWorker = await qrtWorker.start();

console.log("Requesting sales report...");
const jobChain = await qrtClient.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    qrtClient.startJobChain({
      ...ctx,
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
const result = await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 5000 });
console.log(`Report ready! ID: ${result.output.reportId}, Rows: ${result.output.rowCount}`);

// 10. Cleanup
await stopWorker();
await sql.end();
await pgContainer.stop();
console.log("Done!");
