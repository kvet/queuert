import { createRedisNotifyAdapter } from "@queuert/redis";
import { acquireRedis } from "@queuert/testcontainers";
import { runNotifyAdapterConformance } from "queuert/conformance";
import { type RedisClientType, createClient } from "redis";
import { test } from "vitest";

import { createNodeRedisNotifyProvider } from "./provider.js";

test("notify-redis-redis provider passes notify adapter conformance", async () => {
  await using redis = await acquireRedis("redis:8");

  await runNotifyAdapterConformance(async () => {
    const client = createClient({ url: redis.connectionUrl }) as RedisClientType;
    const subscribeClient = createClient({ url: redis.connectionUrl }) as RedisClientType;
    await client.connect();
    await subscribeClient.connect();

    const notifyProvider = createNodeRedisNotifyProvider({ client, subscribeClient });
    const notifyAdapter = await createRedisNotifyAdapter({
      notifyProvider,
      channelPrefix: `queuert:spec:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        await client.close();
        await subscribeClient.close();
      },
    };
  });
}, 60_000);
