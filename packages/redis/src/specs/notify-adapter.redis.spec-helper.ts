import type { NotifyAdapter } from "@queuert/core";
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
): TestAPI<T & { notifyAdapter: NotifyAdapter }> => {
  return api.extend<{
    notifyAdapter: NotifyAdapter;
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
          keyPrefix: `queuert:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        });

        await use(notifyAdapter);

        await client.close();
        await subscribeClient.close();
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithRedisNotify<T>>;
};
