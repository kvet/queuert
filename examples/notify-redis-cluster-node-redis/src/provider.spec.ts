import { runRedisNotifyProviderConformance } from "@queuert/redis/conformance";
import { acquireRedisCluster } from "@queuert/testcontainers";
import { createCluster, type RedisClusterType } from "redis";
import { test } from "vitest";

import { createNodeRedisClusterNotifyProvider } from "./provider.ts";

// #region conformance
test("notify-redis-cluster-node-redis provider passes notify provider conformance", async () => {
  await using rc = await acquireRedisCluster("redis:8");

  await runRedisNotifyProviderConformance(async () => {
    const cluster = createCluster({ rootNodes: rc.rootNodes }) as RedisClusterType;
    const subscribeCluster = createCluster({ rootNodes: rc.rootNodes }) as RedisClusterType;
    await cluster.connect();
    await subscribeCluster.connect();

    const notifyProvider = createNodeRedisClusterNotifyProvider({ cluster, subscribeCluster });

    return {
      notifyProvider,
      dispose: async () => {
        await cluster.close();
        await subscribeCluster.close();
      },
    };
  });
}, 60_000);
// #endregion
