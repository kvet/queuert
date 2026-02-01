import { createNatsNotifyAdapter } from "@queuert/nats";
import { NatsContainer } from "@testcontainers/nats";
import { connect } from "nats";
import { createClient, createInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";

// 1. Start NATS using testcontainers (with JetStream enabled)
console.log("Starting NATS...");
const natsContainer = await new NatsContainer("nats:2.10").withArg("-js").start();
const connectionOptions = natsContainer.getConnectionOptions();

// 2. Create NATS connection
const nc = await connect(connectionOptions);

// 3. Create JetStream KV bucket for thundering herd optimization (optional but recommended)
const js = nc.jetstream();
const kv = await js.views.kv("queuert_example", { ttl: 60_000 });

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
const notifyAdapter = await createNatsNotifyAdapter({
  nc,
  kv,
  subjectPrefix: "queuert.example",
});

// 6. Create client and worker
const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

const qrtWorker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
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
await nc.close();
await natsContainer.stop();
console.log("Done!");
