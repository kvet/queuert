import { createRedisNotifyAdapter } from "@queuert/redis";
import { acquireRedis } from "@queuert/testcontainers";
import { RedisClient } from "bun";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
  createInProcessStateAdapter,
} from "queuert";

import { createBunRedisNotifyProvider } from "./provider.ts";

// Start Redis using testcontainers
console.log("Starting Redis...");
await using redisContainer = await acquireRedis("redis:8");
const redisUrl = redisContainer.connectionUrl;

// Define job types
const jobTypes = defineJobTypes<{
  generate_report: {
    entry: true;
    input: { reportType: string; dateRange: { from: string; to: string } };
    output: { reportId: string; rowCount: number };
  };
}>();

// Create the state adapter
const stateAdapter = createInProcessStateAdapter();

// #region setup
// Create Redis connections (pub/sub needs a dedicated connection)
const redis = new RedisClient(redisUrl);
await redis.connect();

const redisSubscription = new RedisClient(redisUrl);
await redisSubscription.connect();

// Create the notify provider using Bun Redis
const notifyProvider = createBunRedisNotifyProvider({
  client: redis,
  subscribeClient: redisSubscription,
});

// Create the notify adapter
const notifyAdapter = createRedisNotifyAdapter({ notifyProvider });
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
// #region cleanup
await notifyAdapter.close();
await stateAdapter.close();
redis.close();
redisSubscription.close();
// #endregion
console.log("Done!");
