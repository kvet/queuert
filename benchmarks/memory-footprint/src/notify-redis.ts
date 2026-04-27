/**
 * Redis Notify Adapter Memory Measurement
 */

import { createRedisNotifyAdapter } from "@queuert/redis";
import { RedisContainer } from "@testcontainers/redis";
import { createNodeRedisNotifyProvider } from "example-notify-redis-redis/provider";
import {
  createClient,
  createInProcessStateAdapter,
  createInProcessWorker,
  createProcessors,
  withTransactionHooks,
} from "queuert";
import { type RedisClientType, createClient as createRedisClient } from "redis";

import {
  diffMemory,
  jobTypes,
  measureMemory,
  printHeader,
  runDoubleRunBenchmark,
} from "./utils.js";

printHeader("REDIS NOTIFY ADAPTER");

type Infra = {
  redis: RedisClientType;
  redisSubscription: RedisClientType;
};

await runDoubleRunBenchmark<Infra>({
  name: "notify-redis",
  setupInfrastructure: async () => {
    console.log("\nStarting Redis container...");
    const [beforeContainer, afterContainer, redisContainer] = await measureMemory(async () =>
      new RedisContainer("redis:8").withExposedPorts(6379).start(),
    );
    console.log("\nAfter starting container (testcontainers overhead):");
    diffMemory(beforeContainer, afterContainer);

    const [beforeConnection, afterConnection, conns] = await measureMemory(async () => {
      const redisClient = createRedisClient({
        url: redisContainer.getConnectionUrl(),
      }) as RedisClientType;
      const redisSubscription = createRedisClient({
        url: redisContainer.getConnectionUrl(),
      }) as RedisClientType;
      await redisClient.connect();
      await redisSubscription.connect();
      return { redisClient, redisSubscription };
    });
    console.log("\nAfter creating Redis connections (2 clients, node-redis overhead):");
    diffMemory(beforeConnection, afterConnection);

    return {
      infra: {
        redis: conns.redisClient,
        redisSubscription: conns.redisSubscription,
      },
      teardown: async () => {
        await conns.redisClient.quit();
        await conns.redisSubscription.quit();
        await redisContainer.stop();
      },
    };
  },
  runLifecycle: async ({ redis, redisSubscription }, { step, processStep }) => {
    const stateAdapter = await step("After creating state adapter", async () =>
      createInProcessStateAdapter(),
    );

    const notifyAdapter = await step("After creating notify adapter", async () =>
      createRedisNotifyAdapter({
        notifyProvider: createNodeRedisNotifyProvider({
          client: redis,
          subscribeClient: redisSubscription,
        }),
      }),
    );

    const setup = await step("After creating client + worker", async () => {
      const client = await createClient({ stateAdapter, notifyAdapter, jobTypes });
      const worker = await createInProcessWorker({
        client,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            "test-job": {
              attemptHandler: async ({ complete }) => complete(async () => ({ processed: true })),
            },
          },
        }),
      });
      const stopWorker = await worker.start();
      return { client, stopWorker };
    });

    await processStep("After processing 100 jobs", async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        const jobChain = await withTransactionHooks(async (transactionHooks) =>
          stateAdapter.withTransaction(async (ctx) =>
            setup.client.startJobChain({
              ...ctx,
              transactionHooks,
              typeName: "test-job",
              input: { message: `Test message ${i}` },
            }),
          ),
        );
        promises.push(setup.client.awaitJobChain(jobChain, { timeoutMs: 5000 }));
      }
      await Promise.all(promises);
    });

    await setup.stopWorker();
    await notifyAdapter.close();
    await stateAdapter.close();
  },
});
