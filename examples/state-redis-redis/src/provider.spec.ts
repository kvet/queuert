import {
  createRedisStateProviderConformanceContext,
  type RedisStateProviderConformanceContext,
  redisStateProviderConformanceCases,
} from "@queuert/redis/conformance";
import { acquireRedis, type AcquiredRedis } from "@queuert/testcontainers";
import { createClient, type RedisClientType } from "redis";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createNodeRedisStateProvider } from "./provider.ts";

// #region conformance
describe("state-redis-redis provider conformance", () => {
  let redis: AcquiredRedis;
  let client: RedisClientType;
  let context: RedisStateProviderConformanceContext;

  beforeAll(async () => {
    redis = await acquireRedis("redis:8");
    client = createClient({ url: redis.connectionUrl });
    await client.connect();
    context = createRedisStateProviderConformanceContext({
      createStateProvider: async () => createNodeRedisStateProvider({ client }),
    });
  }, 60_000);

  afterAll(async () => {
    await client.close();
    await redis[Symbol.asyncDispose]();
  });

  for (const conformanceCase of redisStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
