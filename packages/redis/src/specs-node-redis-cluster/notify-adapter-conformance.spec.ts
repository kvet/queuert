import { extendWithRedisCluster } from "@queuert/testcontainers";
import type { NotifyConformanceFixture } from "queuert/conformance";
import { notifyAdapterBaseGroups } from "queuert/conformance-internal";
import { type ConformanceFixtures, conformanceTestSuite } from "queuert/testing";
import { createCluster, type RedisClusterType } from "redis";
import { it as baseIt, describe } from "vitest";

import {
  createRedisNotifyConformanceContext,
  redisNotifyProviderConformanceGroups,
} from "../conformance/notify-provider-conformance.ts";
import { createRedisNotifyAdapter } from "../notify-adapter/notify-adapter.redis.ts";
import { createNodeRedisClusterNotifyProvider } from "./notify-provider.node-redis-cluster.ts";

const it = extendWithRedisCluster(baseIt, import.meta.url);

const providerIt = it.extend<ConformanceFixtures<NotifyConformanceFixture>>({
  conformance: [
    async ({ redisClusterConnection }, use) => {
      const cluster = createCluster(redisClusterConnection) as RedisClusterType;
      const subscribeCluster = createCluster(redisClusterConnection) as RedisClusterType;
      await cluster.connect();
      await subscribeCluster.connect();
      await use(
        createRedisNotifyConformanceContext({
          notifyProvider: createNodeRedisClusterNotifyProvider({ cluster, subscribeCluster }),
        }),
      );
      await cluster.close();
      await subscribeCluster.close();
    },
    { scope: "file" },
  ],
});

const customPrefixIt = it.extend<ConformanceFixtures<NotifyConformanceFixture>>({
  conformance: [
    async ({ redisClusterConnection }, use) => {
      const cluster = createCluster(redisClusterConnection) as RedisClusterType;
      const subscribeCluster = createCluster(redisClusterConnection) as RedisClusterType;
      await cluster.connect();
      await subscribeCluster.connect();
      await use({
        notifyAdapter: createRedisNotifyAdapter({
          notifyProvider: createNodeRedisClusterNotifyProvider({ cluster, subscribeCluster }),
          channelPrefix: `myapp:notifications:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        }),
      });
      await cluster.close();
      await subscribeCluster.close();
    },
    { scope: "file" },
  ],
});

// NOTE: hack for vitest plugin
it("index");

describe("Redis Cluster Notify Provider Conformance", () => {
  conformanceTestSuite({ it: providerIt, groups: redisNotifyProviderConformanceGroups });
});

describe("Redis Cluster Notify Adapter Conformance - Custom Channel Prefix", () => {
  conformanceTestSuite({ it: customPrefixIt, groups: notifyAdapterBaseGroups });
});
