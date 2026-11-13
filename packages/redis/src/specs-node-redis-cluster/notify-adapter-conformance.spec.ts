// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireRedisCluster } from "@queuert/testcontainers";
import { notifyAdapterEndToEndGroups } from "queuert/conformance-internal";
import { createCluster, type RedisClusterType } from "redis";
import { it as baseIt, describe } from "vitest";

import {
  createRedisNotifyProviderConformanceContext,
  redisNotifyProviderConformanceGroups,
} from "../conformance/notify-provider-conformance.ts";
import { createNodeRedisClusterNotifyProvider } from "./notify-provider.node-redis-cluster.ts";

const redisCluster = await acquireRedisCluster("redis:6");

const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const cluster = createCluster(redisCluster) as RedisClusterType;
  const subscribeCluster = createCluster(redisCluster) as RedisClusterType;
  await cluster.connect();
  await subscribeCluster.connect();
  onCleanup(async () => {
    await cluster.close();
    await subscribeCluster.close();
  });
  return createRedisNotifyProviderConformanceContext({
    createNotifyProvider: async () =>
      createNodeRedisClusterNotifyProvider({ cluster, subscribeCluster }),
  });
});

// NOTE: hack for vitest plugin
baseIt("index");

describe("Redis Cluster Notify Provider Conformance", () => {
  conformanceTestSuite({
    mode: "async",
    it,
    groups: [...redisNotifyProviderConformanceGroups, ...notifyAdapterEndToEndGroups],
  });
});
