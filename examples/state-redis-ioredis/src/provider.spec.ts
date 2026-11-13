import {
  createRedisStateProviderConformanceContext,
  type RedisStateProviderConformanceContext,
  redisStateProviderConformanceCases,
} from "@queuert/redis/conformance";
import { acquireRedis, type AcquiredRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createIoredisStateProvider } from "./provider.ts";

// #region conformance
describe("state-redis-ioredis provider conformance", () => {
  let redis: AcquiredRedis;
  let client: Redis;
  let context: RedisStateProviderConformanceContext;

  beforeAll(async () => {
    redis = await acquireRedis("redis:8");
    client = new Redis(redis.connectionUrl);
    context = createRedisStateProviderConformanceContext({
      createStateProvider: async () => createIoredisStateProvider({ client }),
    });
  }, 60_000);

  afterAll(async () => {
    await client.quit();
    await redis[Symbol.asyncDispose]();
  });

  for (const conformanceCase of redisStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
