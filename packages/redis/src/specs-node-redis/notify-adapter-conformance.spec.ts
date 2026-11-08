import { extendWithRedis } from "@queuert/testcontainers";
import type { NotifyConformanceFixture } from "queuert/conformance";
import { notifyAdapterBaseGroups } from "queuert/conformance-internal";
import { type ConformanceFixtures, conformanceTestSuite } from "queuert/testing";
import { type RedisClientType, createClient } from "redis";
import { it as baseIt, describe } from "vitest";

import {
  createRedisNotifyConformanceContext,
  redisNotifyProviderConformanceGroups,
} from "../conformance/notify-provider-conformance.ts";
import { createRedisNotifyAdapter } from "../notify-adapter/notify-adapter.redis.ts";
import { createNodeRedisNotifyProvider } from "./notify-provider.node-redis.ts";

const it = extendWithRedis(baseIt, import.meta.url);

const providerIt = it.extend<ConformanceFixtures<NotifyConformanceFixture>>({
  conformance: [
    async ({ redisConnectionUrl }, use) => {
      const client = createClient({ url: redisConnectionUrl }) as RedisClientType;
      const subscribeClient = createClient({ url: redisConnectionUrl }) as RedisClientType;
      await client.connect();
      await subscribeClient.connect();
      await use(
        createRedisNotifyConformanceContext({
          notifyProvider: createNodeRedisNotifyProvider({ client, subscribeClient }),
        }),
      );
      await client.close();
      await subscribeClient.close();
    },
    { scope: "file" },
  ],
});

const customPrefixIt = it.extend<ConformanceFixtures<NotifyConformanceFixture>>({
  conformance: [
    async ({ redisConnectionUrl }, use) => {
      const client = createClient({ url: redisConnectionUrl }) as RedisClientType;
      const subscribeClient = createClient({ url: redisConnectionUrl }) as RedisClientType;
      await client.connect();
      await subscribeClient.connect();
      await use({
        notifyAdapter: createRedisNotifyAdapter({
          notifyProvider: createNodeRedisNotifyProvider({ client, subscribeClient }),
          channelPrefix: `myapp:notifications:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        }),
      });
      await client.close();
      await subscribeClient.close();
    },
    { scope: "file" },
  ],
});

// NOTE: hack for vitest plugin
it("index");

describe("Redis Notify Provider Conformance", () => {
  conformanceTestSuite({ it: providerIt, groups: redisNotifyProviderConformanceGroups });
});

describe("Redis Notify Adapter Conformance - Custom Channel Prefix", () => {
  conformanceTestSuite({ it: customPrefixIt, groups: notifyAdapterBaseGroups });
});
