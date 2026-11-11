import { createRedisNotifyAdapter } from "@queuert/redis";
import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import { acquireRedis } from "@queuert/testcontainers";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";
import { createClient as createRedisClient } from "redis";

import { createNodeRedisNotifyProvider } from "./provider.ts";

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

// #region setup
await using drivers = new AsyncDisposableStack();
// #hide
// Create the state adapter
const db = drivers.adopt(new Database(":memory:"), (db) => {
  db.close();
});
await using stateAdapter = createSqliteStateAdapter({
  stateProvider: createBetterSqlite3StateProvider({ db, lock: createAsyncRwLock() }),
});
await stateAdapter.migrateToLatest();
// #endhide

// Create Redis connections
const redis = drivers.adopt(createRedisClient({ url: redisUrl }), async (redis) => {
  await redis.quit();
});
// #hide
redis.on("error", (err) => {
  console.error("Redis Client Error", err);
});
// #endhide
await redis.connect();

const redisSubscription = drivers.adopt(
  createRedisClient({ url: redisUrl }),
  async (redisSubscription) => {
    await redisSubscription.quit();
  },
);
// #hide
redisSubscription.on("error", (err) => {
  console.error("Redis Subscription Error", err);
});
// #endhide
await redisSubscription.connect();

// Create the notify provider using node-redis
const notifyProvider = createNodeRedisNotifyProvider({
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
await workerRunner.start();

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

console.log("Done!");
