import { afterAll, beforeAll, describe, test } from "bun:test";

import { createRedisNotifyProviderConformanceContext } from "@queuert/redis/conformance";
import { acquireRedis, type AcquiredRedis } from "@queuert/testcontainers";
import { RedisClient } from "bun";

import { createBunRedisNotifyProvider } from "./provider.ts";

// #region conformance
describe("notify-redis-bun provider conformance", () => {
  let redis: AcquiredRedis;
  let client: RedisClient;
  let subscribeClient: RedisClient;
  const { context, cases } = createRedisNotifyProviderConformanceContext({
    createNotifyProvider: async () => createBunRedisNotifyProvider({ client, subscribeClient }),
  });

  beforeAll(async () => {
    redis = await acquireRedis("redis:8");
    client = new RedisClient(redis.connectionUrl);
    subscribeClient = new RedisClient(redis.connectionUrl);
    await client.connect();
    await subscribeClient.connect();
  }, 60_000);

  afterAll(async () => {
    client.close();
    subscribeClient.close();
    await redis[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
