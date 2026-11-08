import { createRedisNotifyAdapter } from "@queuert/redis";
import { acquireRedisCluster } from "@queuert/testcontainers";
import { Cluster } from "ioredis";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
  createInProcessStateAdapter,
} from "queuert";

import { createIoredisClusterNotifyProvider } from "./provider.ts";

// Start a Redis Cluster using testcontainers
console.log("Starting Redis Cluster...");
await using rc = await acquireRedisCluster("redis:8");

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
const startupNodes = rc.rootNodes.map((node) => node.url);

// Create Redis Cluster connections
const cluster = new Cluster(startupNodes);
const subscribeCluster = new Cluster(startupNodes);
// #hide
cluster.on("error", (err: Error) => {
  console.error("Redis Cluster Error", err);
});
subscribeCluster.on("error", (err: Error) => {
  console.error("Redis Cluster Subscription Error", err);
});
// #endhide

// Create the notify provider using ioredis cluster
const notifyProvider = createIoredisClusterNotifyProvider({
  cluster,
  subscribeCluster,
});

// Create the notify adapter
const notifyAdapter = await createRedisNotifyAdapter({ notifyProvider });
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
          await new Promise((r) => setTimeout(r, 500));
          const rowCount = Math.floor(Math.random() * 1000) + 100;
          console.log(`Report generated with ${rowCount} rows`);
          return withTransactionHooks(async (transactionHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                transactionHooks,
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
const chain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      transactionHooks,
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
await cluster.quit();
await subscribeCluster.quit();
// #endregion
console.log("Done!");
