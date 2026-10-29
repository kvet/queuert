import { type NotifyAdapter } from "queuert";
import { type TestSuiteContext, createFlakyBatchGenerator } from "queuert/testing";
import { type RedisClientType, createClient } from "redis";
import { type TestAPI, expect } from "vitest";

import { createRedisNotifyAdapter } from "../notify-adapter/notify-adapter.redis.js";
import { createNodeRedisNotifyProvider } from "../specs-node-redis/notify-provider.node-redis.js";

export const extendWithNotifyRedis = <
  T extends {
    redisConnectionUrl: string;
  },
>(
  api: TestAPI<T>,
): TestAPI<T & Pick<TestSuiteContext, "notifyAdapter"> & { flakyNotifyAdapter: NotifyAdapter }> => {
  return api.extend<{
    notifyAdapter: NotifyAdapter;
    flakyNotifyAdapter: NotifyAdapter;
  }>({
    notifyAdapter: [
      async ({ redisConnectionUrl }, use) => {
        const client = createClient({ url: redisConnectionUrl }) as RedisClientType;
        const subscribeClient = createClient({ url: redisConnectionUrl }) as RedisClientType;
        await client.connect();
        await subscribeClient.connect();

        const notifyProvider = createNodeRedisNotifyProvider({ client, subscribeClient });
        const notifyAdapter = await createRedisNotifyAdapter({
          notifyProvider,
          channelPrefix: `queuert:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        });

        await use(notifyAdapter);

        await client.close();
        await subscribeClient.close();
      },
      { scope: "test" },
    ],
    flakyNotifyAdapter: [
      async ({ notifyAdapter }, use) => {
        let totalCalls = 0;
        let errorCalls = 0;
        const shouldError = createFlakyBatchGenerator();

        const maybeThrow = (): void => {
          totalCalls++;

          if (shouldError()) {
            errorCalls++;
            const error = new Error("connection reset") as Error & { code: string };
            error.code = "ECONNRESET";
            throw error;
          }
        };

        const flakyNotifyAdapter: NotifyAdapter = {
          notifyJobsScheduled: async (typeNames) => {
            maybeThrow();
            return notifyAdapter.notifyJobsScheduled(typeNames);
          },
          listenJobScheduled: async (typeNames, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobScheduled(typeNames, onNotification);
          },
          notifyChainsCompleted: async (chainIds) => {
            maybeThrow();
            return notifyAdapter.notifyChainsCompleted(chainIds);
          },
          listenChainCompleted: async (chainId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenChainCompleted(chainId, onNotification);
          },
          notifyJobAttemptsLost: async (jobIds) => {
            maybeThrow();
            return notifyAdapter.notifyJobAttemptsLost(jobIds);
          },
          listenJobAttemptLost: async (jobId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobAttemptLost(jobId, onNotification);
          },
          close: notifyAdapter.close,
        };

        await use(flakyNotifyAdapter);

        // Verify that errors were actually injected if enough calls were made
        if (totalCalls > 5) {
          expect(errorCalls).toBeGreaterThan(0);
        }
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithNotifyRedis<T>>;
};
