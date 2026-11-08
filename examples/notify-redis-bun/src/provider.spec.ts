import { test } from "bun:test";

import { runRedisNotifyProviderConformance } from "@queuert/redis/conformance";
import { acquireRedis } from "@queuert/testcontainers";
import { RedisClient } from "bun";

import { createBunRedisNotifyProvider } from "./provider.ts";

// #region conformance
test("notify-redis-bun provider passes notify provider conformance", async () => {
  await using redis = await acquireRedis("redis:8");

  await runRedisNotifyProviderConformance(async () => {
    const client = new RedisClient(redis.connectionUrl);
    const subscribeClient = new RedisClient(redis.connectionUrl);
    await client.connect();
    await subscribeClient.connect();

    const notifyProvider = createBunRedisNotifyProvider({ client, subscribeClient });

    return {
      notifyProvider,
      dispose: async () => {
        client.close();
        subscribeClient.close();
      },
    };
  });
}, 120_000);
// #endregion
