import {
  createRedisNotifyProviderConformanceContext,
  type NotifyAdapterConformanceContext,
  redisNotifyProviderConformanceCases,
} from "@queuert/redis/conformance";
import { acquireRedisCluster, type AcquiredRedisCluster } from "@queuert/testcontainers";
import { createCluster, type RedisClusterType } from "redis";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createNodeRedisClusterNotifyProvider } from "./provider.ts";

// #region conformance
describe("notify-redis-cluster-node-redis provider conformance", () => {
  let rc: AcquiredRedisCluster;
  let cluster: RedisClusterType;
  let subscribeCluster: RedisClusterType;
  let context: NotifyAdapterConformanceContext;

  beforeAll(async () => {
    rc = await acquireRedisCluster("redis:8");
    cluster = createCluster({ rootNodes: rc.rootNodes });
    subscribeCluster = createCluster({ rootNodes: rc.rootNodes });
    await cluster.connect();
    await subscribeCluster.connect();
    context = createRedisNotifyProviderConformanceContext({
      createNotifyProvider: async () =>
        createNodeRedisClusterNotifyProvider({ cluster, subscribeCluster }),
    });
  }, 60_000);

  afterAll(async () => {
    await cluster.close();
    await subscribeCluster.close();
    await rc[Symbol.asyncDispose]();
  });

  for (const conformanceCase of redisNotifyProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
