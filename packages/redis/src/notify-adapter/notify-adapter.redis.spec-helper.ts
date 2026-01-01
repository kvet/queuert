import type { NotifyAdapter } from "@queuert/core";
import { withContainerLock } from "@queuert/testcontainers";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { createClient, RedisClientType } from "redis";
import { beforeAll, type TestAPI } from "vitest";
import { createNodeRedisNotifyProvider } from "../notify-provider/notify-provider.node-redis.js";
import { createRedisNotifyAdapter } from "./notify-adapter.redis.js";

const CONTAINER_NAME = "queuert-redis-test";

export const extendWithRedisNotify = <T>(
  api: TestAPI<T>,
  _reuseId: string,
): TestAPI<T & { notifyAdapter: NotifyAdapter }> => {
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
    notifyAdapter: NotifyAdapter;
  }>({
    notifyAdapter: [
      async ({}, use) => {
        const connectionUrl = container.getConnectionUrl();
        const client = createClient({ url: connectionUrl }) as RedisClientType;
        const subscribeClient = createClient({ url: connectionUrl }) as RedisClientType;
        await client.connect();
        await subscribeClient.connect();

        const provider = createNodeRedisNotifyProvider({ client, subscribeClient });
        const notifyAdapter = await createRedisNotifyAdapter({
          provider,
          keyPrefix: `queuert:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        });

        await use(notifyAdapter);

        await client.close();
        await subscribeClient.close();
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithRedisNotify<T>>;
};
