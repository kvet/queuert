import {
  createRedisNotifyProviderConformanceContext,
  type NotifyAdapterConformanceContext,
  redisNotifyProviderConformanceCases,
} from "@queuert/redis/conformance";
import { acquireRedisCluster, type AcquiredRedisCluster } from "@queuert/testcontainers";
import { Cluster } from "ioredis";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createIoredisClusterNotifyProvider } from "./provider.ts";

// #region conformance
describe("notify-redis-cluster-ioredis provider conformance", () => {
  let rc: AcquiredRedisCluster;
  let cluster: Cluster;
  let subscribeCluster: Cluster;
  let context: NotifyAdapterConformanceContext;

  beforeAll(async () => {
    rc = await acquireRedisCluster("redis:8");
    const startupNodes = rc.rootNodes.map((node) => node.url);
    cluster = new Cluster(startupNodes);
    subscribeCluster = new Cluster(startupNodes);
    context = createRedisNotifyProviderConformanceContext({
      createNotifyProvider: async () =>
        createIoredisClusterNotifyProvider({ cluster, subscribeCluster }),
    });
  }, 60_000);

  afterAll(async () => {
    await cluster.quit();
    await subscribeCluster.quit();
    await rc[Symbol.asyncDispose]();
  });

  for (const conformanceCase of redisNotifyProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
