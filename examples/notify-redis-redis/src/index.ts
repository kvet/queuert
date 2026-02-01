import { type RedisNotifyProvider, createRedisNotifyAdapter } from "@queuert/redis";
import { RedisContainer } from "@testcontainers/redis";
import {
  createConsoleLog,
  createQueuertClient,
  createQueuertInProcessWorker,
  defineJobTypes,
} from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";
import { createClient } from "redis";

// 1. Start Redis using testcontainers
console.log("Starting Redis...");
const redisContainer = await new RedisContainer("redis:7").withExposedPorts(6379).start();
const redisUrl = redisContainer.getConnectionUrl();

// 2. Create Redis connections
const redis = createClient({ url: redisUrl });
redis.on("error", (err) => {
  console.error("Redis Client Error", err);
});
await redis.connect();

const redisSubscription = createClient({ url: redisUrl });
redisSubscription.on("error", (err) => {
  console.error("Redis Subscription Error", err);
});
await redisSubscription.connect();

// 3. Create the notify provider using node-redis
const notifyProvider: RedisNotifyProvider = {
  publish: async (channel, message) => {
    await redis.publish(channel, message);
  },
  subscribe: async (channel, onMessage) => {
    await redisSubscription.subscribe(channel, onMessage);
    return async () => {
      await redisSubscription.unsubscribe(channel);
    };
  },
  eval: async (script, keys, args) => {
    return redis.eval(script, { keys, arguments: args });
  },
};

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
const notifyAdapter = await createRedisNotifyAdapter({ provider: notifyProvider });
const log = createConsoleLog();

// 6. Create client and worker
const qrtClient = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  log,
  registry,
});

const qrtWorker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
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
await redis.quit();
await redisSubscription.quit();
await redisContainer.stop();
console.log("Done!");
