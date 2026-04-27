import { createRedisNotifyAdapter } from "@queuert/redis";
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
  createInProcessStateAdapter,
} from "queuert";

import { createIoredisNotifyProvider } from "./provider.js";

// 1. Start Redis using testcontainers
console.log("Starting Redis...");
await using redisContainer = await acquireRedis("redis:8");
const redisUrl = redisContainer.connectionUrl;

// 2. Create Redis connections
const redis = new Redis(redisUrl);
redis.on("error", (err: Error) => {
  console.error("Redis Client Error", err);
});

const redisSubscription = new Redis(redisUrl);
redisSubscription.on("error", (err: Error) => {
  console.error("Redis Subscription Error", err);
});

// 3. Create the notify provider using ioredis
const notifyProvider = createIoredisNotifyProvider({
  client: redis,
  subscribeClient: redisSubscription,
});

// 4. Define job types
const jobTypes = defineJobTypes<{
  generate_report: {
    entry: true;
    input: { reportType: string; dateRange: { from: string; to: string } };
    output: { reportId: string; rowCount: number };
  };
}>();

// 5. Create adapters
const stateAdapter = await createInProcessStateAdapter();
const notifyAdapter = await createRedisNotifyAdapter({ notifyProvider });

// 6. Create client and worker
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
const stopWorker = await worker.start();

console.log("Requesting sales report...");
const jobChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startJobChain({
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
const result = await client.awaitJobChain(jobChain, { timeoutMs: 5000 });
console.log(`Report ready! ID: ${result.output.reportId}, Rows: ${result.output.rowCount}`);

// 10. Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await redis.quit();
await redisSubscription.quit();
console.log("Done!");
