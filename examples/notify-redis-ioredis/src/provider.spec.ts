import { runRedisNotifyProviderConformance } from "@queuert/redis/conformance";
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import { test } from "vitest";

import { createIoredisNotifyProvider } from "./provider.ts";

// #region conformance
test("notify-redis-ioredis provider passes notify provider conformance", async () => {
  await using redis = await acquireRedis("redis:8");

  await runRedisNotifyProviderConformance(async () => {
    const client = new Redis(redis.connectionUrl);
    const subscribeClient = new Redis(redis.connectionUrl);

    const notifyProvider = createIoredisNotifyProvider({ client, subscribeClient });

    return {
      notifyProvider,
      dispose: async () => {
        await client.quit();
        await subscribeClient.quit();
      },
    };
  });
}, 60_000);
// #endregion
