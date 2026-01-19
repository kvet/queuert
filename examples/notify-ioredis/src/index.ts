import { createRedisNotifyAdapter, RedisNotifyProvider } from "@queuert/redis";
import { RedisContainer } from "@testcontainers/redis";
import {
  createConsoleLog,
  createQueuertClient,
  createQueuertInProcessWorker,
  defineJobTypes,
} from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";
import { createRedis } from "./redis.js";

// 1. Start Redis using testcontainers
const redisContainer = await new RedisContainer("redis:6").withExposedPorts(6379).start();

// 2. Create Redis connections
const redis = createRedis({
  url: redisContainer.getConnectionUrl(),
});
// Separate Redis client for subscriptions (ioredis requires dedicated clients for pub/sub)
const redisSubscription = createRedis({
  url: redisContainer.getConnectionUrl(),
});

// 3. Create notify provider for ioredis
// ioredis uses a single 'message' event for all subscriptions, so we track handlers per channel.
// Queuert subscribes once per channel (multiplexing internally), so a simple Map suffices here.
// For multi-subscriber scenarios outside Queuert, use Map<string, Set<Handler>> instead.
const channelHandlers = new Map<string, (message: string) => void>();

redisSubscription.on("message", (channel: string, message: string) => {
  const handler = channelHandlers.get(channel);
  if (handler) {
    handler(message);
  }
});

const notifyProvider: RedisNotifyProvider = {
  publish: async (channel, message) => {
    await redis.publish(channel, message);
  },
  subscribe: async (channel, onMessage) => {
    channelHandlers.set(channel, onMessage);
    await redisSubscription.subscribe(channel);
    return async () => {
      await redisSubscription.unsubscribe(channel);
      channelHandlers.delete(channel);
    };
  },
  eval: async (script, keys, args) => {
    return redis.eval(script, keys.length, ...keys, ...args);
  },
};

// 4. Define job types
const jobTypeRegistry = defineJobTypes<{
  greet: {
    entry: true;
    input: { name: string };
    output: { greeting: string };
  };
}>();

// 5. Create shared adapters for Queuert client and worker
const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = await createRedisNotifyAdapter({
  provider: notifyProvider,
});
const log = createConsoleLog();

const qrtClient = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry,
});

// 6. Create and start qrtWorker
const qrtWorker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry,
  jobTypeProcessors: {
    greet: {
      process: async ({ job, complete }) => {
        console.log(`Processing greet job for ${job.input.name}`);
        return complete(async () => ({
          greeting: `Hello, ${job.input.name}!`,
        }));
      },
    },
  },
});

const stopWorker = await qrtWorker.start();

// 7. Start a job chain
const jobChain = await qrtClient.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    qrtClient.startJobChain({
      ...ctx,
      typeName: "greet",
      input: { name: "World" },
    }),
  ),
);

// 8. Wait for completion
const completed = await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 5000 });
console.log("Job completed with output:", completed.output);

// 9. Cleanup
await stopWorker();
await redis.quit();
await redisSubscription.quit();
await redisContainer.stop();
