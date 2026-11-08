import { extendWithRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import type { NotifyConformanceFixture } from "queuert/conformance";
import { notifyAdapterBaseGroups } from "queuert/conformance-internal";
import { type ConformanceFixtures, conformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe } from "vitest";

import {
  createRedisNotifyConformanceContext,
  redisNotifyProviderConformanceGroups,
} from "../conformance/notify-provider-conformance.ts";
import { createRedisNotifyAdapter } from "../notify-adapter/notify-adapter.redis.ts";
import { createIoredisNotifyProvider } from "./notify-provider.ioredis.ts";

const it = extendWithRedis(baseIt, import.meta.url);

const providerIt = it.extend<ConformanceFixtures<NotifyConformanceFixture>>({
  conformance: [
    async ({ redisConnectionUrl }, use) => {
      const client = new Redis(redisConnectionUrl);
      const subscribeClient = new Redis(redisConnectionUrl);
      await use(
        createRedisNotifyConformanceContext({
          notifyProvider: createIoredisNotifyProvider({ client, subscribeClient }),
        }),
      );
      await client.quit();
      await subscribeClient.quit();
    },
    { scope: "file" },
  ],
});

const customPrefixIt = it.extend<ConformanceFixtures<NotifyConformanceFixture>>({
  conformance: [
    async ({ redisConnectionUrl }, use) => {
      const client = new Redis(redisConnectionUrl);
      const subscribeClient = new Redis(redisConnectionUrl);
      await use({
        notifyAdapter: createRedisNotifyAdapter({
          notifyProvider: createIoredisNotifyProvider({ client, subscribeClient }),
          channelPrefix: `myapp:notifications:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        }),
      });
      await client.quit();
      await subscribeClient.quit();
    },
    { scope: "file" },
  ],
});

// NOTE: hack for vitest plugin
it("index");

describe("Redis Notify Provider Conformance (ioredis)", () => {
  conformanceTestSuite({ it: providerIt, groups: redisNotifyProviderConformanceGroups });
});

describe("Redis Notify Adapter Conformance (ioredis) - Custom Channel Prefix", () => {
  conformanceTestSuite({ it: customPrefixIt, groups: notifyAdapterBaseGroups });
});
