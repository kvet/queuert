import { createRedisNotifyProviderConformanceCases } from "@queuert/redis/conformance";
import { acquireRedis, type AcquiredRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createIoredisNotifyProvider } from "./provider.ts";

// #region conformance
describe("notify-redis-ioredis provider conformance", () => {
  let redis: AcquiredRedis;
  let client: Redis;
  let subscribeClient: Redis;
  const cases = createRedisNotifyProviderConformanceCases({
    createNotifyProvider: async () => createIoredisNotifyProvider({ client, subscribeClient }),
  });

  beforeAll(async () => {
    redis = await acquireRedis("redis:8");
    client = new Redis(redis.connectionUrl);
    subscribeClient = new Redis(redis.connectionUrl);
  }, 60_000);

  afterAll(async () => {
    await client.quit();
    await subscribeClient.quit();
    await redis[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
// #endregion
