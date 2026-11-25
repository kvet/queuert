import { createPgStateAdapter } from "@queuert/postgres";
import { createRedisNotifyAdapter } from "@queuert/redis";
import { acquirePostgres, acquireRedis } from "@queuert/testcontainers";
import { RedisClient, SQL } from "bun";
import { createBunSqlStateProvider } from "example-postgresql-state-bun-sql/provider";
import { createClient, createWorkerRunner, createProcessors, defineJobTypes } from "queuert";

import { createBunRedisNotifyProvider } from "./provider.ts";

console.log("Starting Redis...");
await using redisContainer = await acquireRedis("redis:8");
const redisUrl = redisContainer.connectionUrl;

const jobTypes = defineJobTypes<{
  generate_report: {
    entry: true;
    input: { reportType: string; dateRange: { from: string; to: string } };
    output: { reportId: string; rowCount: number };
  };
}>();

console.log("Starting PostgreSQL...");
await using pg = await acquirePostgres("postgres:18", import.meta.url);
await using stateSql = new SQL(pg.connectionString, { max: 10 });
await using stateAdapter = createPgStateAdapter({
  stateProvider: createBunSqlStateProvider({ sql: stateSql }),
});
await stateAdapter.migrateToLatest();

// #region setup
await using drivers = new AsyncDisposableStack();
const redis = drivers.adopt(new RedisClient(redisUrl), (redis) => {
  redis.close();
});
await redis.connect();

const redisSubscription = drivers.adopt(new RedisClient(redisUrl), (redisSubscription) => {
  redisSubscription.close();
});
await redisSubscription.connect();

const notifyProvider = createBunRedisNotifyProvider({
  client: redis,
  subscribeClient: redisSubscription,
});

await using notifyAdapter = createRedisNotifyAdapter({ notifyProvider });
// #endregion

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
        attemptHandler: async ({ job, applyJobOutcome }) => {
          console.log(`Generating ${job.input.reportType} report...`);
          await new Promise((r) => setTimeout(r, 500));
          const rowCount = Math.floor(Math.random() * 1000) + 100;
          console.log(`Report generated with ${rowCount} rows`);
          await stateAdapter.withTransaction(async (ctx) =>
            applyJobOutcome({
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

await workerRunner.start();

console.log("Requesting sales report...");
const chain = await stateAdapter.withTransaction(async (ctx) =>
  client.createChain({
    ...ctx,
    typeName: "generate_report",
    input: { reportType: "sales", dateRange: { from: "2024-01-01", to: "2024-12-31" } },
  }),
);

console.log("Report queued! Continuing with other work...");
console.log("Preparing email template...");
await new Promise((resolve) => setTimeout(resolve, 100));
console.log("Loading recipient list...");
await new Promise((resolve) => setTimeout(resolve, 100));

console.log("Waiting for report...");
const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Report ready! ID: ${result.output.reportId}, Rows: ${result.output.rowCount}`);

console.log("Done!");
