import { extendWithRedis } from "@queuert/testcontainers";
import {
  type NotifyAdapterConformanceContext,
  notifyAdapterConformanceTestSuite,
} from "queuert/testing";
import { type RedisClientType, createClient } from "redis";
import { it as baseIt, describe } from "vitest";
import { createRedisNotifyAdapter } from "../notify-adapter/notify-adapter.redis.js";
import { createNodeRedisNotifyProvider } from "./notify-provider.node-redis.js";

const it = extendWithRedis(baseIt, import.meta.url);

// NOTE: hack for vitest plugin
it("index");

describe("Redis Notify Adapter Conformance - Default Channel Prefix", () => {
  const conformanceIt = it.extend<NotifyAdapterConformanceContext>({
    notifyAdapter: [
      async ({ redisConnectionUrl }, use) => {
        const client = createClient({ url: redisConnectionUrl }) as RedisClientType;
        const subscribeClient = createClient({ url: redisConnectionUrl }) as RedisClientType;
        await client.connect();
        await subscribeClient.connect();

        const provider = createNodeRedisNotifyProvider({ client, subscribeClient });
        const notifyAdapter = await createRedisNotifyAdapter({ provider });

        await use(notifyAdapter);

        await client.close();
        await subscribeClient.close();
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});

describe("Redis Notify Adapter Conformance - Custom Channel Prefix", () => {
  const conformanceIt = it.extend<NotifyAdapterConformanceContext>({
    notifyAdapter: [
      async ({ redisConnectionUrl }, use) => {
        const client = createClient({ url: redisConnectionUrl }) as RedisClientType;
        const subscribeClient = createClient({ url: redisConnectionUrl }) as RedisClientType;
        await client.connect();
        await subscribeClient.connect();

        const provider = createNodeRedisNotifyProvider({ client, subscribeClient });
        const notifyAdapter = await createRedisNotifyAdapter({
          provider,
          channelPrefix: "myapp:notifications",
        });

        await use(notifyAdapter);

        await client.close();
        await subscribeClient.close();
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});
