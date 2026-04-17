import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { type TestAPI, beforeAll } from "vitest";

import { withContainerLock } from "./with-container-lock.js";

/**
 * Port layout used by `grokzen/redis-cluster`:
 *   - Redis client ports: INITIAL_PORT .. INITIAL_PORT+5  (6 nodes: 3 masters + 3 replicas)
 *
 * The image advertises nodes using the value of $IP. Setting IP=0.0.0.0 lets us rewrite
 * advertised addresses via node-redis's `nodeAddressMap` so the cluster is reachable
 * from the host regardless of docker network layout.
 */
const INITIAL_PORT = 7000;
const NODE_PORTS = [0, 1, 2, 3, 4, 5].map((i) => INITIAL_PORT + i);

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

export type AcquiredRedisCluster = RedisClusterConnection & AsyncDisposable;

const containerNameFromImage = (image: string): string =>
  `queuert-redis-cluster-${image.replace(/[^a-z0-9]/gi, "-")}-test`;

const containerPromises = new Map<string, Promise<StartedTestContainer>>();

const startContainer = async (image: string): Promise<StartedTestContainer> => {
  let promise = containerPromises.get(image);
  if (!promise) {
    const containerName = containerNameFromImage(image);
    promise = withContainerLock({
      containerName,
      start: async () =>
        new GenericContainer(image)
          .withName(containerName)
          .withLabels({ label: containerName })
          .withExposedPorts(...NODE_PORTS)
          .withEnvironment({
            IP: "0.0.0.0",
            INITIAL_PORT: String(INITIAL_PORT),
            MASTERS: "3",
            SLAVES_PER_MASTER: "1",
          })
          .withWaitStrategy(Wait.forLogMessage(/Cluster state changed: ok/i, 6))
          .withStartupTimeout(120_000)
          .withReuse()
          .start(),
    });
    containerPromises.set(image, promise);
  }
  return promise;
};

const connectionFromContainer = (container: StartedTestContainer): RedisClusterConnection => {
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

  return { rootNodes, nodeAddressMap };
};

export const acquireRedisCluster = async (image: string): Promise<AcquiredRedisCluster> => {
  const container = await startContainer(image);

  return {
    ...connectionFromContainer(container),
    [Symbol.asyncDispose]: async () => {},
  };
};

export const extendWithRedisCluster = <T>(
  api: TestAPI<T>,
  _reuseId: string,
): TestAPI<T & { redisClusterConnection: RedisClusterConnection }> => {
  let container: StartedTestContainer;

  beforeAll(async () => {
    container = await startContainer("grokzen/redis-cluster:7.0.10");
  }, 180_000);

  return api.extend<{ redisClusterConnection: RedisClusterConnection }>({
    redisClusterConnection: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(connectionFromContainer(container));
      },
      { scope: "worker" },
    ],
  }) as unknown as TestAPI<T & { redisClusterConnection: RedisClusterConnection }>;
};
