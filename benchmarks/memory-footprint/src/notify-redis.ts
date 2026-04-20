/**
 * Redis Notify Adapter Memory Measurement
 */

import { type RedisNotifyProvider, createRedisNotifyAdapter } from "@queuert/redis";
import { RedisContainer } from "@testcontainers/redis";
import {
  createClient,
  createInProcessStateAdapter,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  withTransactionHooks,
} from "queuert";
import { createClient as createRedisClient } from "redis";

import {
  diffMemory,
  jobTypeRegistry,
  measureBaseline,
  measureMemory,
  printHeader,
  printSummary,
} from "./utils.js";

printHeader("REDIS NOTIFY ADAPTER");

const baseline = await measureBaseline();

console.log("\nStarting Redis container...");
const [beforeContainer, afterContainer, redisContainer] = await measureMemory(async () =>
  new RedisContainer("redis:8").withExposedPorts(6379).start(),
);
console.log("\nAfter starting container (testcontainers overhead):");
diffMemory(beforeContainer, afterContainer);

const redisUrl = redisContainer.getConnectionUrl();

const [beforeConnection, afterConnection, { redis, redisSubscription }] = await measureMemory(
  async () => {
    const redis = createRedisClient({ url: redisUrl });
    const redisSubscription = createRedisClient({ url: redisUrl });
    await redis.connect();
    await redisSubscription.connect();
    return { redis, redisSubscription };
  },
);
console.log("\nAfter creating Redis connections (2 clients):");
diffMemory(beforeConnection, afterConnection);

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

const stateAdapter = await createInProcessStateAdapter();
const [beforeAdapter, afterAdapter, notifyAdapter] = await measureMemory(async () =>
  createRedisNotifyAdapter({ notifyProvider }),
);
console.log("\nAfter creating RedisNotifyAdapter:");
diffMemory(beforeAdapter, afterAdapter);

const [beforeSetup, afterSetup, { qrtClient, stopWorker }] = await measureMemory(async () => {
  const qrtClient = await createClient({
    stateAdapter,
    notifyAdapter,
    jobTypeRegistry,
  });

  const qrtWorker = await createInProcessWorker({
    client: qrtClient,
    jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
      client: qrtClient,
      jobTypeRegistry,
      processors: {
        "test-job": {
          attemptHandler: async ({ complete }) => complete(async () => ({ processed: true })),
        },
      },
    }),
  });

  const stopWorker = await qrtWorker.start();
  return { qrtClient, stopWorker };
});
console.log("\nAfter creating client + worker:");
diffMemory(beforeSetup, afterSetup);

console.log("\nProcessing 100 jobs...");
const [beforeProcessing, afterProcessing] = await measureMemory(async () => {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (ctx) =>
        qrtClient.startJobChain({
          ...ctx,
          transactionHooks,
          typeName: "test-job",
          input: { message: `Test message ${i}` },
        }),
      ),
    );
    promises.push(qrtClient.awaitJobChain(jobChain, { timeoutMs: 5000 }));
  }
  await Promise.all(promises);
});
console.log("\nAfter processing 100 jobs:");
diffMemory(beforeProcessing, afterProcessing);

await stopWorker();
await redis.quit();
await redisSubscription.quit();
await redisContainer.stop();

const [, afterCleanup] = await measureMemory(async () => {});
console.log("\nAfter cleanup (delta from baseline):");
diffMemory(baseline, afterCleanup);

printSummary([
  ["Container + driver:", afterConnection.heapUsed - baseline.heapUsed],
  ["Notify adapter:", afterAdapter.heapUsed - beforeAdapter.heapUsed],
  ["Client + worker:", afterSetup.heapUsed - beforeSetup.heapUsed],
]);
