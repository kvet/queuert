import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";

import { withContainerLock } from "./with-container-lock.ts";

export type AcquiredRedis = {
  connectionUrl: string;
} & AsyncDisposable;

const containerNameFromImage = (image: string): string =>
  `queuert-redis-${image.replace(/[^a-z0-9]/gi, "-")}-test`;

const containerPromises = new Map<string, Promise<StartedRedisContainer>>();

const startContainer = async (image: string): Promise<StartedRedisContainer> => {
  let promise = containerPromises.get(image);
  if (!promise) {
    const containerName = containerNameFromImage(image);
    promise = withContainerLock({
      containerName,
      start: async () =>
        new RedisContainer(image)
          .withName(containerName)
          .withLabels({ label: containerName })
          .withExposedPorts(6379)
          .withReuse()
          .start(),
    });
    containerPromises.set(image, promise);
  }
  return promise;
};

export const acquireRedis = async (image: string): Promise<AcquiredRedis> => {
  const container = await startContainer(image);

  return {
    connectionUrl: container.getConnectionUrl(),
    [Symbol.asyncDispose]: async () => {},
  };
};
