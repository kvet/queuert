import { createRedisNotifyAdapter, createRedisStateAdapter } from "@queuert/redis";
import { createNodeRedisNotifyProvider } from "example-postgresql-notify-redis-redis/provider";
import { createNodeRedisStateProvider } from "example-redis-state-redis/provider";
import { createClient, createProcessors, createWorkerRunner, defineJobTypes } from "queuert";
import { createClient as createRedisClient } from "redis";

const jobTypes = defineJobTypes<{
  process_order: {
    entry: true;
    input: { orderId: string; items: string[]; total: number };
    output: { processedAt: string; processName: string };
  };
}>();

const redisUrl = process.env.REDIS_URL!;
const processName = process.env.PROCESS_NAME!;

const resources = new AsyncDisposableStack();
const redis = resources.adopt(
  await createRedisClient({ url: redisUrl }).connect(),
  async (redis) => {
    await redis.close();
  },
);
const redisSubscription = resources.adopt(
  await createRedisClient({ url: redisUrl }).connect(),
  async (redisSubscription) => {
    await redisSubscription.close();
  },
);

const stateAdapter = resources.use(
  createRedisStateAdapter({
    stateProvider: createNodeRedisStateProvider({ client: redis }),
    keyPrefix: "{queuert}:",
  }),
);
const notifyAdapter = resources.use(
  createRedisNotifyAdapter({
    notifyProvider: createNodeRedisNotifyProvider({
      client: redis,
      subscribeClient: redisSubscription,
    }),
  }),
);

const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

const workerRunner = createWorkerRunner({
  client,
  concurrency: 2,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      process_order: {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          process.send!({
            type: "processing",
            orderId: job.input.orderId,
            items: job.input.items.length,
            total: job.input.total,
          });

          await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));

          await stateAdapter.withTransaction(async (txCtx) =>
            applyJobOutcome({
              ...txCtx,
              output: { processedAt: new Date().toISOString(), processName },
            }),
          );
        },
      },
    },
  }),
});

resources.use(workerRunner);
await workerRunner.start();
process.send!({ type: "ready" });

process.on("message", (msg) => {
  if (msg === "stop") {
    void (async () => {
      await resources.disposeAsync();
      process.send!({ type: "stopped" });
      process.exit(0);
    })();
  }
});
