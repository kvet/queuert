import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { type TestAPI, beforeAll } from "vitest";
import { withContainerLock } from "./with-container-lock.js";

const CONTAINER_NAME = "queuert-redis-test";

export const extendWithRedis = <T>(
  api: TestAPI<T>,
  _reuseId: string,
): TestAPI<
  T & {
    redisConnectionUrl: string;
  }
> => {
  let container: StartedRedisContainer;

  beforeAll(async () => {
    container = await withContainerLock({
      containerName: CONTAINER_NAME,
      start: async () =>
        new RedisContainer("redis:7")
          .withName(CONTAINER_NAME)
          .withLabels({
            label: CONTAINER_NAME,
          })
          .withExposedPorts(6379)
          .withReuse()
          .start(),
    });
  }, 60_000);

  return api.extend<{
    redisConnectionUrl: string;
  }>({
    redisConnectionUrl: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(container.getConnectionUrl());
      },
      { scope: "worker" },
    ],
  }) as unknown as TestAPI<
    T & {
      redisConnectionUrl: string;
    }
  >;
};
