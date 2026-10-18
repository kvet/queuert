import { createRedisNotifyAdapter } from "@queuert/redis";
import { acquireRedisCluster } from "@queuert/testcontainers";
import { Cluster } from "ioredis";
import { runNotifyAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createIoredisClusterNotifyProvider } from "./provider.js";

test("notify-redis-cluster-ioredis provider passes notify adapter conformance", async () => {
  await using rc = await acquireRedisCluster("redis:8");

  await runNotifyAdapterConformance(async () => {
    const startupNodes = rc.rootNodes.map((node) => node.url);

    const cluster = new Cluster(startupNodes);
    const subscribeCluster = new Cluster(startupNodes);

    const notifyProvider = createIoredisClusterNotifyProvider({ cluster, subscribeCluster });
    const notifyAdapter = await createRedisNotifyAdapter({
      notifyProvider,
      channelPrefix: `queuert:spec:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        await cluster.quit();
        await subscribeCluster.quit();
      },
    };
  });
}, 60_000);
