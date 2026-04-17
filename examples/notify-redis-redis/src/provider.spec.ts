import { createRedisNotifyAdapter } from "@queuert/redis";
import { RedisContainer } from "@testcontainers/redis";
import { runNotifyAdapterConformance } from "queuert/conformance";
import { type RedisClientType, createClient } from "redis";
import { test } from "vitest";

import { createNodeRedisNotifyProvider } from "./provider.js";

test("notify-redis-redis provider passes notify adapter conformance", async () => {
  await runNotifyAdapterConformance(async () => {
    const container = await new RedisContainer("redis:8").withExposedPorts(6379).start();
    const redisUrl = container.getConnectionUrl();

    const client = createClient({ url: redisUrl }) as RedisClientType;
    const subscribeClient = createClient({ url: redisUrl }) as RedisClientType;
    await client.connect();
    await subscribeClient.connect();

    const provider = createNodeRedisNotifyProvider({ client, subscribeClient });
    const notifyAdapter = await createRedisNotifyAdapter({
      provider,
      channelPrefix: `queuert:spec:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        await client.close();
        await subscribeClient.close();
        await container.stop();
      },
    };
  });
}, 60_000);
