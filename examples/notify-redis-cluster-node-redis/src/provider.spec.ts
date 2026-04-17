import { createRedisNotifyAdapter } from "@queuert/redis";
import { acquireRedisCluster } from "@queuert/testcontainers";
import { runNotifyAdapterConformance } from "queuert/conformance";
import { createCluster, type RedisClusterType } from "redis";
import { test } from "vitest";

import { createNodeRedisClusterNotifyProvider } from "./provider.js";

test("notify-redis-cluster-node-redis provider passes notify adapter conformance", async () => {
  await using rc = await acquireRedisCluster("grokzen/redis-cluster:7.0.10");

  await runNotifyAdapterConformance(async () => {
    const cluster = createCluster({
      rootNodes: rc.rootNodes,
      nodeAddressMap: rc.nodeAddressMap,
    }) as RedisClusterType;
    const subscribeCluster = createCluster({
      rootNodes: rc.rootNodes,
      nodeAddressMap: rc.nodeAddressMap,
    }) as RedisClusterType;
    await cluster.connect();
    await subscribeCluster.connect();

    const notifyProvider = createNodeRedisClusterNotifyProvider({ cluster, subscribeCluster });
    const notifyAdapter = await createRedisNotifyAdapter({
      notifyProvider,
      channelPrefix: `queuert:spec:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        await cluster.close();
        await subscribeCluster.close();
      },
    };
  });
}, 60_000);
