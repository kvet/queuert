import { createRedisStateProviderConformanceContext } from "@queuert/redis/conformance";
import { acquireRedis, type AcquiredRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createIoredisStateProvider } from "./provider.ts";

// #region conformance
describe("redis/state-ioredis provider conformance", () => {
  let redis: AcquiredRedis;
  let client: Redis;
  const { context, cases } = createRedisStateProviderConformanceContext({
    createStateProvider: async () => createIoredisStateProvider({ client }),
  });

  beforeAll(async () => {
    redis = await acquireRedis("redis:8");
    client = new Redis(redis.connectionUrl);
  }, 60_000);

  afterAll(async () => {
    await client.quit();
    await redis[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
