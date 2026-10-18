import { test } from "bun:test";

import { createRedisNotifyAdapter } from "@queuert/redis";
import { acquireRedis } from "@queuert/testcontainers";
import { RedisClient } from "bun";
import { runNotifyAdapterConformance } from "queuert/conformance";

import { createBunRedisNotifyProvider } from "./provider.js";

test("notify-redis-bun provider passes notify adapter conformance", async () => {
  await using redis = await acquireRedis("redis:8");

  await runNotifyAdapterConformance(async () => {
    const client = new RedisClient(redis.connectionUrl);
    const subscribeClient = new RedisClient(redis.connectionUrl);
    await client.connect();
    await subscribeClient.connect();

    const notifyProvider = createBunRedisNotifyProvider({ client, subscribeClient });
    const notifyAdapter = await createRedisNotifyAdapter({
      notifyProvider,
      channelPrefix: `queuert:spec:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        client.close();
        subscribeClient.close();
      },
    };
  });
}, 120_000);
