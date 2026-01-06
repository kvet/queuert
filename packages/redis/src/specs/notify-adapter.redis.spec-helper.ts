import type { NotifyAdapter } from "queuert";
import { createClient, RedisClientType } from "redis";
import { type TestAPI } from "vitest";
import { createRedisNotifyAdapter } from "../notify-adapter/notify-adapter.redis.js";
import { createNodeRedisNotifyProvider } from "./notify-provider.node-redis.js";

export const extendWithRedisNotify = <
  T extends {
    redisConnectionUrl: string;
  },
>(
  api: TestAPI<T>,
): TestAPI<T & { notifyAdapter: NotifyAdapter; flakyNotifyAdapter: NotifyAdapter }> => {
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

        const provider = createNodeRedisNotifyProvider({ client, subscribeClient });
        const notifyAdapter = await createRedisNotifyAdapter({
          provider,
          channelPrefix: `queuert:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        });

        await use(notifyAdapter);

        await client.close();
        await subscribeClient.close();
      },
      { scope: "test" },
    ],
    flakyNotifyAdapter: [
      async ({ notifyAdapter, expect }, use) => {
        let totalCalls = 0;
        let errorCalls = 0;

        // Seeded PRNG (mulberry32) for reproducible randomness
        const seed = 12345;
        let state = seed;
        const random = () => {
          state = (state + 0x6d2b79f5) | 0;
          let t = Math.imul(state ^ (state >>> 15), 1 | state);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };

        // Generate batch sizes: alternate between success (5-15) and error (1-20) batches
        let inErrorBatch = false;
        let batchRemaining = Math.floor(random() * 11) + 5; // First success batch: 5-15

        const maybeThrow = (): void => {
          totalCalls++;
          batchRemaining--;

          if (batchRemaining <= 0) {
            inErrorBatch = !inErrorBatch;
            batchRemaining = inErrorBatch
              ? Math.floor(random() * 20) + 1 // Error batch: 1-20
              : Math.floor(random() * 11) + 5; // Success batch: 5-15
          }

          if (inErrorBatch) {
            errorCalls++;
            const error = new Error("connection reset") as Error & { code: string };
            error.code = "ECONNRESET";
            throw error;
          }
        };

        const flakyNotifyAdapter: NotifyAdapter = {
          notifyJobScheduled: async (typeName, count) => {
            maybeThrow();
            return notifyAdapter.notifyJobScheduled(typeName, count);
          },
          listenJobScheduled: async (typeNames, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobScheduled(typeNames, onNotification);
          },
          notifyJobSequenceCompleted: async (sequenceId) => {
            maybeThrow();
            return notifyAdapter.notifyJobSequenceCompleted(sequenceId);
          },
          listenJobSequenceCompleted: async (sequenceId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobSequenceCompleted(sequenceId, onNotification);
          },
          notifyJobOwnershipLost: async (jobId) => {
            maybeThrow();
            return notifyAdapter.notifyJobOwnershipLost(jobId);
          },
          listenJobOwnershipLost: async (jobId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobOwnershipLost(jobId, onNotification);
          },
        };

        await use(flakyNotifyAdapter);

        // Verify that errors were actually injected if enough calls were made
        if (totalCalls > 5) {
          expect(errorCalls).toBeGreaterThan(0);
        }
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithRedisNotify<T>>;
};
