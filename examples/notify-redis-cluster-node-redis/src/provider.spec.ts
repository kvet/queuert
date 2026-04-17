import { createRedisNotifyAdapter } from "@queuert/redis";
import { runNotifyAdapterConformance } from "queuert/conformance";
import { createCluster, type RedisClusterType } from "redis";
import { GenericContainer, Wait } from "testcontainers";
import { test } from "vitest";

import { createNodeRedisClusterNotifyProvider } from "./provider.js";

const INITIAL_PORT = 7000;
const NODE_PORTS = [0, 1, 2, 3, 4, 5].map((i) => INITIAL_PORT + i);

test("notify-redis-cluster-node-redis provider passes notify adapter conformance", async () => {
  await runNotifyAdapterConformance(async () => {
    const container = await new GenericContainer("grokzen/redis-cluster:7.0.10")
      .withExposedPorts(...NODE_PORTS)
      .withEnvironment({
        IP: "0.0.0.0",
        INITIAL_PORT: String(INITIAL_PORT),
        MASTERS: "3",
        SLAVES_PER_MASTER: "1",
      })
      .withWaitStrategy(Wait.forLogMessage(/Cluster state changed: ok/i, 6))
      .withStartupTimeout(120_000)
      .start();

    const host = container.getHost();
    const portMap = new Map<number, number>();
    for (const internalPort of NODE_PORTS) {
      portMap.set(internalPort, container.getMappedPort(internalPort));
    }
    const nodeAddressMap = (address: string) => {
      const portStr = address.split(":").pop();
      if (!portStr) return undefined;
      const mappedPort = portMap.get(Number(portStr));
      if (mappedPort === undefined) return undefined;
      return { host, port: mappedPort };
    };
    const rootNodes = NODE_PORTS.map((internalPort) => ({
      url: `redis://${host}:${container.getMappedPort(internalPort)}`,
    }));

    const cluster = createCluster({ rootNodes, nodeAddressMap }) as RedisClusterType;
    const subscribeCluster = createCluster({ rootNodes, nodeAddressMap }) as RedisClusterType;
    await cluster.connect();
    await subscribeCluster.connect();

    const provider = createNodeRedisClusterNotifyProvider({ cluster, subscribeCluster });
    const notifyAdapter = await createRedisNotifyAdapter({
      provider,
      channelPrefix: `queuert:spec:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        await cluster.close();
        await subscribeCluster.close();
        await container.stop();
      },
    };
  });
}, 300_000);
