import { createRedisNotifyAdapter } from "@queuert/redis";
import { acquireRedisCluster } from "@queuert/testcontainers";
import { Cluster } from "ioredis";
import {
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
} from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";

import { createIoredisClusterNotifyProvider } from "./provider.js";

// 1. Start a Redis Cluster using testcontainers
console.log("Starting Redis Cluster...");
await using rc = await acquireRedisCluster("grokzen/redis-cluster:7.0.10");

const startupNodes = rc.rootNodes.map((node) => {
  const url = new URL(node.url);
  return { host: url.hostname, port: Number(url.port) };
});
const natMap = (address: string) => {
  const result = rc.nodeAddressMap(address);
  return result ?? null;
};

// 2. Create Redis Cluster connections
const cluster = new Cluster(startupNodes, { natMap });
cluster.on("error", (err: Error) => {
  console.error("Redis Cluster Error", err);
});

const subscribeCluster = new Cluster(startupNodes, { natMap });
subscribeCluster.on("error", (err: Error) => {
  console.error("Redis Cluster Subscription Error", err);
});

// 3. Create the notify provider using ioredis cluster
const notifyProvider = createIoredisClusterNotifyProvider({
  cluster,
  subscribeCluster,
});

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
const notifyAdapter = await createRedisNotifyAdapter({ notifyProvider });

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
await cluster.quit();
await subscribeCluster.quit();
console.log("Done!");
