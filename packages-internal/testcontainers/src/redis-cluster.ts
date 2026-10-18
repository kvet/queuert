import { createHash } from "node:crypto";

import { GenericContainer, Wait } from "testcontainers";
import { type TestAPI, beforeAll } from "vitest";

import { withContainerLock } from "./with-container-lock.js";

/**
 * Runs a 6-node cluster (3 masters + 3 replicas) inside a single stock `redis` container, so the
 * same images used for standalone Redis (official, multi-arch) cover cluster mode too.
 *
 * Each node is published on the same host port it listens on, so the `127.0.0.1:<port>` addresses
 * the cluster advertises are reachable from the host without any address remapping. Ports are
 * derived from the image so clusters of different versions can run side by side, and stay below
 * the ephemeral range Docker picks mapped ports from.
 */
const nodePortsFromImage = (image: string): number[] => {
  const hash = createHash("sha1").update(image).digest().readUInt16BE(0);
  const basePort = 20_000 + (hash % 1_000) * 10;
  return [0, 1, 2, 3, 4, 5].map((offset) => basePort + offset);
};

// Node state lives on tmpfs, which is wiped when a stopped container is reused, so every boot
// forms a fresh cluster.
const clusterScript = (ports: number[]): string => `
for p in ${ports.join(" ")}; do
  mkdir /cluster/$p
  redis-server --port $p --dir /cluster/$p --cluster-enabled yes --save "" --protected-mode no &
  until redis-cli -p $p ping >/dev/null 2>&1; do sleep 0.1; done
done
redis-cli --cluster create ${ports.map((port) => `127.0.0.1:${port}`).join(" ")} --cluster-replicas 1 --cluster-yes
wait
`;

const clusterReadyCommand = (ports: number[]): string =>
  ports.map((port) => `redis-cli -p ${port} cluster info | grep -q cluster_state:ok`).join(" && ");

export type RedisClusterConnection = {
  /** Root node URLs reachable from the host, suitable for `createCluster`. */
  rootNodes: { url: string }[];
};

export type AcquiredRedisCluster = RedisClusterConnection & AsyncDisposable;

const containerNameFromImage = (image: string): string =>
  `queuert-redis-cluster-${image.replace(/[^a-z0-9]/gi, "-")}-test`;

const connectionPromises = new Map<string, Promise<RedisClusterConnection>>();

const startCluster = async (image: string): Promise<RedisClusterConnection> => {
  let promise = connectionPromises.get(image);
  if (!promise) {
    const containerName = containerNameFromImage(image);
    const ports = nodePortsFromImage(image);
    promise = withContainerLock({
      containerName,
      start: async () =>
        new GenericContainer(image)
          .withName(containerName)
          .withLabels({ label: containerName })
          .withExposedPorts(...ports.map((port) => ({ container: port, host: port })))
          .withTmpFs({ "/cluster": "rw" })
          .withCommand(["sh", "-c", clusterScript(ports)])
          .withWaitStrategy(Wait.forSuccessfulCommand(clusterReadyCommand(ports)))
          .withStartupTimeout(120_000)
          .withReuse()
          .start(),
    }).then(() => ({ rootNodes: ports.map((port) => ({ url: `redis://127.0.0.1:${port}` })) }));
    connectionPromises.set(image, promise);
  }
  return promise;
};

export const acquireRedisCluster = async (image: string): Promise<AcquiredRedisCluster> => {
  const connection = await startCluster(image);

  return {
    ...connection,
    [Symbol.asyncDispose]: async () => {},
  };
};

export const extendWithRedisCluster = <T>(
  api: TestAPI<T>,
  _reuseId: string,
): TestAPI<T & { redisClusterConnection: RedisClusterConnection }> => {
  let connection: RedisClusterConnection;

  beforeAll(async () => {
    connection = await startCluster("redis:6");
  }, 180_000);

  return api.extend<{ redisClusterConnection: RedisClusterConnection }>({
    redisClusterConnection: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(connection);
      },
      { scope: "worker" },
    ],
  }) as unknown as TestAPI<T & { redisClusterConnection: RedisClusterConnection }>;
};
