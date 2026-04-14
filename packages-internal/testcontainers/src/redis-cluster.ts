import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { type TestAPI, beforeAll } from "vitest";

import { withContainerLock } from "./with-container-lock.js";

const CONTAINER_NAME = "queuert-redis-cluster-test";

/**
 * Port layout used by `grokzen/redis-cluster`:
 *   - Redis client ports: INITIAL_PORT .. INITIAL_PORT+5  (6 nodes: 3 masters + 3 replicas)
 *   - Cluster bus ports:  INITIAL_PORT+10000 .. (+5)      (required so nodes can gossip)
 *
 * The image advertises nodes using the value of $IP. Setting IP=0.0.0.0 lets us rewrite
 * advertised addresses via node-redis's `nodeAddressMap` so the cluster is reachable
 * from the host regardless of docker network layout.
 */
const INITIAL_PORT = 7000;
const NODE_PORTS = [0, 1, 2, 3, 4, 5].map((i) => INITIAL_PORT + i);
const BUS_PORTS = NODE_PORTS.map((p) => p + 10000);

export type RedisClusterConnection = {
  /** Root node URLs with host-reachable ports, suitable for `createCluster`. */
  rootNodes: { url: string }[];
  /**
   * Rewrites advertised node addresses to host-reachable `{host, port}` pairs.
   * Keyed by advertised port, since container images inconsistently report
   * `0.0.0.0` vs `127.0.0.1` vs the docker-internal IP as the advertise host.
   */
  nodeAddressMap: (address: string) => { host: string; port: number } | undefined;
};

export const extendWithRedisCluster = <T>(
  api: TestAPI<T>,
  _reuseId: string,
): TestAPI<T & { redisClusterConnection: RedisClusterConnection }> => {
  let container: StartedTestContainer;

  beforeAll(async () => {
    container = await withContainerLock({
      containerName: CONTAINER_NAME,
      start: async () =>
        new GenericContainer("grokzen/redis-cluster:7.0.10")
          .withName(CONTAINER_NAME)
          .withLabels({ label: CONTAINER_NAME })
          .withExposedPorts(...NODE_PORTS, ...BUS_PORTS)
          .withEnvironment({
            IP: "0.0.0.0",
            INITIAL_PORT: String(INITIAL_PORT),
            MASTERS: "3",
            SLAVES_PER_MASTER: "1",
          })
          .withWaitStrategy(Wait.forLogMessage(/Cluster state changed: ok/i, 3))
          .withStartupTimeout(120_000)
          .withReuse()
          .start(),
    });
  }, 180_000);

  return api.extend<{ redisClusterConnection: RedisClusterConnection }>({
    redisClusterConnection: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const host = container.getHost();
        const portMap = new Map<number, number>();
        for (const internalPort of NODE_PORTS) {
          portMap.set(internalPort, container.getMappedPort(internalPort));
        }
        const nodeAddressMap = (address: string): { host: string; port: number } | undefined => {
          const portStr = address.split(":").pop();
          if (!portStr) return undefined;
          const internalPort = Number(portStr);
          const mappedPort = portMap.get(internalPort);
          if (mappedPort === undefined) return undefined;
          return { host, port: mappedPort };
        };
        const rootNodes = NODE_PORTS.map((internalPort) => ({
          url: `redis://${host}:${container.getMappedPort(internalPort)}`,
        }));

        await use({ rootNodes, nodeAddressMap });
      },
      { scope: "worker" },
    ],
  }) as unknown as TestAPI<T & { redisClusterConnection: RedisClusterConnection }>;
};
