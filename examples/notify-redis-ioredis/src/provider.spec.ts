import {
  createRedisNotifyProviderConformanceContext,
  type NotifyAdapterConformanceContext,
  redisNotifyProviderConformanceCases,
} from "@queuert/redis/conformance";
import { acquireRedis, type AcquiredRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createIoredisNotifyProvider } from "./provider.ts";

// #region conformance
describe("notify-redis-ioredis provider conformance", () => {
  let redis: AcquiredRedis;
  let client: Redis;
  let subscribeClient: Redis;
  let context: NotifyAdapterConformanceContext;

  beforeAll(async () => {
    redis = await acquireRedis("redis:8");
    client = new Redis(redis.connectionUrl);
    subscribeClient = new Redis(redis.connectionUrl);
    context = createRedisNotifyProviderConformanceContext({
      createNotifyProvider: async () => createIoredisNotifyProvider({ client, subscribeClient }),
    });
  }, 60_000);

  afterAll(async () => {
    await client.quit();
    await subscribeClient.quit();
    await redis[Symbol.asyncDispose]();
  });

  for (const conformanceCase of redisNotifyProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
