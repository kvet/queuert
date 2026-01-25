/**
 * Redis Notify Adapter Memory Measurement
 */

import { RedisContainer } from "@testcontainers/redis";
import { createClient } from "redis";
import { type RedisNotifyProvider, createRedisNotifyAdapter } from "@queuert/redis";
import { createInProcessStateAdapter } from "queuert/internal";
import { createQueuertClient, createQueuertInProcessWorker } from "queuert";
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
  new RedisContainer("redis:7").withExposedPorts(6379).start(),
);
console.log("\nAfter starting container (testcontainers overhead):");
diffMemory(beforeContainer, afterContainer);

const redisUrl = redisContainer.getConnectionUrl();

const [beforeConnection, afterConnection, { redis, redisSubscription }] = await measureMemory(
  async () => {
    const redis = createClient({ url: redisUrl });
    const redisSubscription = createClient({ url: redisUrl });
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

const stateAdapter = createInProcessStateAdapter();
const [beforeAdapter, afterAdapter, notifyAdapter] = await measureMemory(async () =>
  createRedisNotifyAdapter({ provider: notifyProvider }),
);
console.log("\nAfter creating RedisNotifyAdapter:");
diffMemory(beforeAdapter, afterAdapter);

const [beforeSetup, afterSetup, { qrtClient, stopWorker }] = await measureMemory(async () => {
  const qrtClient = await createQueuertClient({
    stateAdapter,
    notifyAdapter,
    log: () => {},
    jobTypeRegistry,
  });

  const qrtWorker = await createQueuertInProcessWorker({
    stateAdapter,
    notifyAdapter,
    log: () => {},
    jobTypeRegistry,
    jobTypeProcessors: {
      "test-job": {
        process: async ({ complete }) => complete(async () => ({ processed: true })),
      },
    },
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
    const chain = await qrtClient.withNotify(async () =>
      stateAdapter.runInTransaction(async (ctx) =>
        qrtClient.startJobChain({
          ...ctx,
          typeName: "test-job",
          input: { message: `Test message ${i}` },
        }),
      ),
    );
    promises.push(qrtClient.waitForJobChainCompletion(chain, { timeoutMs: 5000 }));
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
