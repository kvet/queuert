import { createRedisNotifyAdapter } from "@queuert/redis";
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import { runNotifyAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createIoredisNotifyProvider } from "./provider.js";

test("notify-redis-ioredis provider passes notify adapter conformance", async () => {
  await using redis = await acquireRedis("redis:8");

  await runNotifyAdapterConformance(async () => {
    const client = new Redis(redis.connectionUrl);
    const subscribeClient = new Redis(redis.connectionUrl);

    const notifyProvider = createIoredisNotifyProvider({ client, subscribeClient });
    const notifyAdapter = await createRedisNotifyAdapter({
      notifyProvider,
      channelPrefix: `queuert:spec:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        await client.quit();
        await subscribeClient.quit();
      },
    };
  });
}, 60_000);
