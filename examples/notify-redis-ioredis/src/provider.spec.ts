import { createRedisNotifyAdapter } from "@queuert/redis";
import { RedisContainer } from "@testcontainers/redis";
import { Redis } from "ioredis";
import { runNotifyAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createIoredisNotifyProvider } from "./provider.js";

test("notify-redis-ioredis provider passes notify adapter conformance", async () => {
  await runNotifyAdapterConformance(async () => {
    const container = await new RedisContainer("redis:8").withExposedPorts(6379).start();
    const redisUrl = container.getConnectionUrl();

    const client = new Redis(redisUrl);
    const subscribeClient = new Redis(redisUrl);

    const provider = createIoredisNotifyProvider({ client, subscribeClient });
    const notifyAdapter = await createRedisNotifyAdapter({
      provider,
      channelPrefix: `queuert:spec:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        await client.quit();
        await subscribeClient.quit();
        await container.stop();
      },
    };
  });
}, 60_000);
