import { createPgStateAdapter } from "@queuert/postgres";
import { createRedisNotifyAdapter } from "@queuert/redis";
import { acquirePostgres, acquireRedis } from "@queuert/testcontainers";
import { createPgPoolStateProvider } from "example-postgresql-state-pg/provider";
import { Redis } from "ioredis";
import { Pool } from "pg";
import { createClient, createWorkerRunner, createProcessors, defineJobTypes } from "queuert";

import { createIoredisNotifyProvider } from "./provider.ts";

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

// #region setup
await using drivers = new AsyncDisposableStack();
// #hide
console.log("Starting PostgreSQL...");
const pg = drivers.use(await acquirePostgres("postgres:18", import.meta.url));
const statePool = drivers.adopt(
  new Pool({ connectionString: pg.connectionString, max: 10 }),
  async (pool) => pool.end(),
);
await using stateAdapter = createPgStateAdapter({
  stateProvider: createPgPoolStateProvider({ pool: statePool }),
});
await stateAdapter.migrateToLatest();
// #endhide

const redis = drivers.adopt(new Redis(redisUrl), async (redis) => {
  await redis.quit();
});
const redisSubscription = drivers.adopt(new Redis(redisUrl), async (redisSubscription) => {
  await redisSubscription.quit();
});
// #hide
redis.on("error", (err: Error) => {
  console.error("Redis Client Error", err);
});
redisSubscription.on("error", (err: Error) => {
  console.error("Redis Subscription Error", err);
});
// #endhide

const notifyProvider = createIoredisNotifyProvider({
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
