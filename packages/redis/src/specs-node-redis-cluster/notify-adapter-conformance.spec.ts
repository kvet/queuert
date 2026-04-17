import { extendWithRedisCluster } from "@queuert/testcontainers";
import {
  type NotifyAdapterConformanceContext,
  notifyAdapterConformanceTestSuite,
} from "queuert/testing";
import { createCluster, type RedisClusterType } from "redis";
import { it as baseIt, describe } from "vitest";

import { createRedisNotifyAdapter } from "../notify-adapter/notify-adapter.redis.js";
import { createNodeRedisClusterNotifyProvider } from "./notify-provider.node-redis-cluster.js";

const it = extendWithRedisCluster(baseIt, import.meta.url);

// NOTE: hack for vitest plugin
it("index");

describe("Redis Cluster Notify Adapter Conformance - Default Channel Prefix", () => {
  const conformanceIt = it.extend<NotifyAdapterConformanceContext>({
    notifyAdapter: [
      async ({ redisClusterConnection }, use) => {
        const cluster = createCluster(redisClusterConnection) as RedisClusterType;
        const subscribeCluster = createCluster(redisClusterConnection) as RedisClusterType;
        await cluster.connect();
        await subscribeCluster.connect();

        const provider = createNodeRedisClusterNotifyProvider({ cluster, subscribeCluster });
        const notifyAdapter = await createRedisNotifyAdapter({
          provider,
          channelPrefix: `queuert:node-redis-cluster:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        });

        await use(notifyAdapter);

        await cluster.close();
        await subscribeCluster.close();
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});

describe("Redis Cluster Notify Adapter Conformance - Custom Channel Prefix", () => {
  const conformanceIt = it.extend<NotifyAdapterConformanceContext>({
    notifyAdapter: [
      async ({ redisClusterConnection }, use) => {
        const cluster = createCluster(redisClusterConnection) as RedisClusterType;
        const subscribeCluster = createCluster(redisClusterConnection) as RedisClusterType;
        await cluster.connect();
        await subscribeCluster.connect();

        const provider = createNodeRedisClusterNotifyProvider({ cluster, subscribeCluster });
        const notifyAdapter = await createRedisNotifyAdapter({
          provider,
          channelPrefix: `myapp:notifications:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        });

        await use(notifyAdapter);

        await cluster.close();
        await subscribeCluster.close();
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});
