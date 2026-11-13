/**
 * Redis State Adapter Memory Measurement
 */

import { createRedisStateAdapter } from "@queuert/redis";
import { RedisContainer } from "@testcontainers/redis";
import { createNodeRedisStateProvider } from "example-state-redis-redis/provider";
import { createClient, createWorkerRunner, createProcessors } from "queuert";
import { type RedisClientType, createClient as createRedisClient } from "redis";

import {
  createCompletionCounter,
  diffMemory,
  jobTypes,
  measureMemory,
  printHeader,
  runDoubleRunBenchmark,
} from "./utils.ts";

printHeader("REDIS STATE ADAPTER");

type Infra = {
  redis: RedisClientType;
};

let lifecycle = 0;

await runDoubleRunBenchmark<Infra>({
  name: "state-redis",
  setupInfrastructure: async () => {
    console.log("\nStarting Redis container...");
    const [beforeContainer, afterContainer, redisContainer] = await measureMemory(async () =>
      new RedisContainer("redis:8").withExposedPorts(6379).start(),
    );
    console.log("\nAfter starting container (testcontainers overhead):");
    diffMemory(beforeContainer, afterContainer);

    const [beforeConnection, afterConnection, redis] = await measureMemory(async () => {
      const client = createRedisClient({
        url: redisContainer.getConnectionUrl(),
      }) as RedisClientType;
      await client.connect();
      return client;
    });
    console.log("\nAfter creating Redis connection (node-redis overhead):");
    diffMemory(beforeConnection, afterConnection);

    return {
      infra: { redis },
      teardown: async () => {
        await redis.quit();
        await redisContainer.stop();
      },
    };
  },
  runLifecycle: async ({ redis }, { step, processStep, jobCount }) => {
    const completions = createCompletionCounter(jobCount);
    lifecycle++;

    const stateAdapter = await step("After creating state adapter", async () => {
      const adapter = createRedisStateAdapter({
        stateProvider: createNodeRedisStateProvider({ client: redis }),
        keyPrefix: `{queuert-${lifecycle}}:`,
      });
      await adapter.migrateToLatest();
      return adapter;
    });

    const setup = await step("After creating client + worker", async () => {
      const client = createClient({ stateAdapter, jobTypes });
      const workerRunner = createWorkerRunner({
        client,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            "test-job": {
              attemptHandler: async ({ complete }) => {
                const result = await stateAdapter.withTransaction(async (txCtx) =>
                  complete({ ...txCtx, output: { processed: true } }),
                );
                completions.record();
                return result;
              },
            },
          },
        }),
      });
      await workerRunner.start();
      return { client, workerRunner };
    });

    await processStep(`After processing ${jobCount} jobs`, async () => {
      for (let i = 0; i < jobCount; i++) {
        await stateAdapter.withTransaction(async (txCtx) =>
          setup.client.createChain({
            ...txCtx,
            typeName: "test-job",
            input: { message: `Test message ${i}` },
          }),
        );
      }
      await completions.done;
    });

    await setup.workerRunner.close();
    await stateAdapter.close();
  },
});
