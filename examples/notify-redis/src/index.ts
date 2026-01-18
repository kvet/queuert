import { createRedisNotifyAdapter, RedisNotifyProvider } from "@queuert/redis";
import { RedisContainer } from "@testcontainers/redis";
import { createConsoleLog, createQueuert, defineJobTypes } from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";
import { createRedis } from "./redis.js";

// 1. Start Redis using testcontainers
const redisContainer = await new RedisContainer("redis:6").withExposedPorts(6379).start();

// 2. Create Redis connections
const redis = await createRedis({
  url: redisContainer.getConnectionUrl(),
});
// Separate Redis client for subscriptions (node-redis requires dedicated clients for pub/sub)
const redisSubscription = await createRedis({
  url: redisContainer.getConnectionUrl(),
});

// 3. Create notify provider for Redis
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
const jobTypeRegistry = defineJobTypes<{
  greet: {
    entry: true;
    input: { name: string };
    output: { greeting: string };
  };
}>();

// 5. Create Queuert with Redis notify adapter and in-process state adapter
const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = await createRedisNotifyAdapter({
  provider: notifyProvider,
});

const qrt = await createQueuert({
  stateAdapter,
  notifyAdapter,
  log: createConsoleLog(),
  jobTypeRegistry,
});

// 6. Create and start a worker
const worker = qrt.createWorker().implementJobType({
  typeName: "greet",
  process: async ({ job, complete }) => {
    console.log(`Processing greet job for ${job.input.name}`);
    return complete(async () => ({
      greeting: `Hello, ${job.input.name}!`,
    }));
  },
});

const stopWorker = await worker.start({ workerId: "worker-1" });

// 7. Start a job chain
const jobChain = await qrt.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    qrt.startJobChain({
      ...ctx,
      typeName: "greet",
      input: { name: "World" },
    }),
  ),
);

// 8. Wait for completion
const completed = await qrt.waitForJobChainCompletion(jobChain, { timeoutMs: 5000 });
console.log("Job completed with output:", completed.output);

// 9. Cleanup
await stopWorker();
await redis.quit();
await redisSubscription.quit();
await redisContainer.stop();
