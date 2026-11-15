import {
  createRedisNotifyProviderConformanceContext,
  type NotifyAdapterConformanceContext,
  redisNotifyProviderConformanceCases,
} from "@queuert/redis/conformance";
import { acquireRedis, type AcquiredRedis } from "@queuert/testcontainers";
import { type RedisClientType, createClient } from "redis";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createNodeRedisNotifyProvider } from "./provider.ts";

// #region conformance
describe("notify-redis-redis provider conformance", () => {
  let redis: AcquiredRedis;
  let client: RedisClientType;
  let subscribeClient: RedisClientType;
  let context: NotifyAdapterConformanceContext;

  beforeAll(async () => {
    redis = await acquireRedis("redis:8");
    client = createClient({ url: redis.connectionUrl });
    subscribeClient = createClient({ url: redis.connectionUrl });
    await client.connect();
    await subscribeClient.connect();
    context = createRedisNotifyProviderConformanceContext({
      createNotifyProvider: async () => createNodeRedisNotifyProvider({ client, subscribeClient }),
    });
  }, 60_000);

  afterAll(async () => {
    await client.close();
    await subscribeClient.close();
    await redis[Symbol.asyncDispose]();
  });

  for (const conformanceCase of redisNotifyProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
