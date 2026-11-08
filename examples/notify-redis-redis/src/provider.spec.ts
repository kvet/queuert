import { runRedisNotifyProviderConformance } from "@queuert/redis/conformance";
import { acquireRedis } from "@queuert/testcontainers";
import { type RedisClientType, createClient } from "redis";
import { test } from "vitest";

import { createNodeRedisNotifyProvider } from "./provider.ts";

// #region conformance
test("notify-redis-redis provider passes notify provider conformance", async () => {
  await using redis = await acquireRedis("redis:8");

  await runRedisNotifyProviderConformance(async () => {
    const client = createClient({ url: redis.connectionUrl }) as RedisClientType;
    const subscribeClient = createClient({ url: redis.connectionUrl }) as RedisClientType;
    await client.connect();
    await subscribeClient.connect();

    const notifyProvider = createNodeRedisNotifyProvider({ client, subscribeClient });

    return {
      notifyProvider,
      dispose: async () => {
        await client.close();
        await subscribeClient.close();
      },
    };
  });
}, 60_000);
// #endregion
