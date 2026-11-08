import { runRedisNotifyProviderConformance } from "@queuert/redis/conformance";
import { acquireRedisCluster } from "@queuert/testcontainers";
import { Cluster } from "ioredis";
import { test } from "vitest";

import { createIoredisClusterNotifyProvider } from "./provider.ts";

// #region conformance
test("notify-redis-cluster-ioredis provider passes notify provider conformance", async () => {
  await using rc = await acquireRedisCluster("redis:8");

  await runRedisNotifyProviderConformance(async () => {
    const startupNodes = rc.rootNodes.map((node) => node.url);

    const cluster = new Cluster(startupNodes);
    const subscribeCluster = new Cluster(startupNodes);

    const notifyProvider = createIoredisClusterNotifyProvider({ cluster, subscribeCluster });

    return {
      notifyProvider,
      dispose: async () => {
        await cluster.quit();
        await subscribeCluster.quit();
      },
    };
  });
}, 60_000);
// #endregion
