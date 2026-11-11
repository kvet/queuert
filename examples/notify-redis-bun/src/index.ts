import { createRedisNotifyAdapter } from "@queuert/redis";
import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import { acquireRedis } from "@queuert/testcontainers";
import { RedisClient, SQL } from "bun";
import { createBunSqlSqliteStateProvider } from "example-state-sqlite-bun-sql/provider";
import { createClient, createWorkerRunner, createProcessors, defineJobTypes } from "queuert";

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
await using sqlite = new SQL("sqlite://:memory:");
await using stateAdapter = createSqliteStateAdapter({
  stateProvider: createBunSqlSqliteStateProvider({ sql: sqlite, lock: createAsyncRwLock() }),
});
await stateAdapter.migrateToLatest();

// #region setup
// Create Redis connections (pub/sub needs a dedicated connection)
await using drivers = new AsyncDisposableStack();
const redis = drivers.adopt(new RedisClient(redisUrl), (redis) => {
  redis.close();
});
await redis.connect();

const redisSubscription = drivers.adopt(new RedisClient(redisUrl), (redisSubscription) => {
  redisSubscription.close();
});
await redisSubscription.connect();

// Create the notify provider using Bun Redis
const notifyProvider = createBunRedisNotifyProvider({
  client: redis,
  subscribeClient: redisSubscription,
});

// Create the notify adapter
await using notifyAdapter = createRedisNotifyAdapter({ notifyProvider });
// #endregion

// Create client and worker runner
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
        attemptHandler: async ({ job, complete }) => {
          console.log(`Generating ${job.input.reportType} report...`);
          // Simulate report generation work
          await new Promise((r) => setTimeout(r, 500));
          const rowCount = Math.floor(Math.random() * 1000) + 100;
          console.log(`Report generated with ${rowCount} rows`);
          return stateAdapter.withTransaction(async (ctx) =>
            complete({
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

// Start worker runner and queue a job
await workerRunner.start();

console.log("Requesting sales report...");
const chain = await stateAdapter.withTransaction(async (ctx) =>
  client.createChain({
    ...ctx,
    typeName: "generate_report",
    input: { reportType: "sales", dateRange: { from: "2024-01-01", to: "2024-12-31" } },
  }),
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

console.log("Done!");
