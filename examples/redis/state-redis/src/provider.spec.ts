import { createRedisStateProviderConformanceContext } from "@queuert/redis/conformance";
import { acquireRedis, type AcquiredRedis } from "@queuert/testcontainers";
import { createClient, type RedisClientType } from "redis";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createNodeRedisStateProvider } from "./provider.ts";

// #region conformance
describe("redis/state-redis provider conformance", () => {
  let redis: AcquiredRedis;
  let client: RedisClientType;
  const { context, cases } = createRedisStateProviderConformanceContext({
    createStateProvider: async () => createNodeRedisStateProvider({ client }),
  });

  beforeAll(async () => {
    redis = await acquireRedis("redis:8");
    client = createClient({ url: redis.connectionUrl });
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    await client.close();
    await redis[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
