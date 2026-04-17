import { extendWithRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import {
  type NotifyAdapterConformanceContext,
  notifyAdapterConformanceTestSuite,
} from "queuert/testing";
import { it as baseIt, describe } from "vitest";

import { createRedisNotifyAdapter } from "../notify-adapter/notify-adapter.redis.js";
import { createIoredisNotifyProvider } from "./notify-provider.ioredis.js";

const it = extendWithRedis(baseIt, import.meta.url);

// NOTE: hack for vitest plugin
it("index");

describe("Redis Notify Adapter Conformance (ioredis) - Default Channel Prefix", () => {
  const conformanceIt = it.extend<NotifyAdapterConformanceContext>({
    notifyAdapter: [
      async ({ redisConnectionUrl }, use) => {
        const client = new Redis(redisConnectionUrl);
        const subscribeClient = new Redis(redisConnectionUrl);

        const provider = createIoredisNotifyProvider({ client, subscribeClient });
        const notifyAdapter = await createRedisNotifyAdapter({
          provider,
          channelPrefix: `queuert:ioredis:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        });

        await use(notifyAdapter);

        await client.quit();
        await subscribeClient.quit();
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});

describe("Redis Notify Adapter Conformance (ioredis) - Custom Channel Prefix", () => {
  const conformanceIt = it.extend<NotifyAdapterConformanceContext>({
    notifyAdapter: [
      async ({ redisConnectionUrl }, use) => {
        const client = new Redis(redisConnectionUrl);
        const subscribeClient = new Redis(redisConnectionUrl);

        const provider = createIoredisNotifyProvider({ client, subscribeClient });
        const notifyAdapter = await createRedisNotifyAdapter({
          provider,
          channelPrefix: `myapp:notifications:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        });

        await use(notifyAdapter);

        await client.quit();
        await subscribeClient.quit();
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});
