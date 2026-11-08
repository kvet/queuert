import { connect } from "@nats-io/transport-node";
import { createNatsNotifyAdapter } from "@queuert/nats";
import { acquireNats } from "@queuert/testcontainers";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTxHooks,
  createInProcessStateAdapter,
} from "queuert";

// Start NATS using testcontainers
console.log("Starting NATS...");
await using natsContainer = await acquireNats("nats:2");
const connectionOptions = natsContainer.connectionOptions;

// Define job types
const jobTypes = defineJobTypes<{
  generate_report: {
    entry: true;
    input: { reportType: string; dateRange: { from: string; to: string } };
    output: { reportId: string; rowCount: number };
  };
}>();

// Create the state adapter
const stateAdapter = await createInProcessStateAdapter();

// #region setup
// Create NATS connection
const nc = await connect(connectionOptions);

// Create the notify adapter
const notifyAdapter = await createNatsNotifyAdapter({
  nc,
  subjectPrefix: "queuert.example",
});
// #endregion

// Create client and worker
const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

const worker = await createInProcessWorker({
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

// Start worker and queue a job
const stopWorker = await worker.start();

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
await stopWorker();
// #region cleanup
await notifyAdapter.close();
await stateAdapter.close();
await nc.close();
// #endregion
console.log("Done!");
