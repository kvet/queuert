// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import { it as baseIt, describe, expect } from "vitest";

import { createRedisStateAdapter } from "../state-adapter/state-adapter.redis.ts";
import { createIoredisStateProvider } from "./state-provider.ioredis.ts";

const redis = await acquireRedis("redis:6");

const it = baseIt.extend("setup", async ({}, { onCleanup }) => {
  const client = new Redis(redis.connectionUrl);
  onCleanup(async () => {
    await client.quit();
  });
  const keyPrefix = `{queuert-${crypto.randomUUID()}}:`;
  const createStateAdapterReportingVersion = (version: string | null) => {
    const stateProvider = createIoredisStateProvider({ client });
    return createRedisStateAdapter({
      stateProvider: {
        ...stateProvider,
        eval: async (script, keys, args) =>
          script.includes("redis_version") ? version : stateProvider.eval(script, keys, args),
      },
      keyPrefix,
    });
  };
  return { client, keyPrefix, createStateAdapterReportingVersion };
});

describe("createRedisStateAdapter server checks", () => {
  it("migrateToLatest accepts the test server", async ({ setup }) => {
    await using stateAdapter = createRedisStateAdapter({
      stateProvider: createIoredisStateProvider({ client: setup.client }),
      keyPrefix: setup.keyPrefix,
    });

    await expect(stateAdapter.migrateToLatest()).resolves.toBeDefined();
  });

  it.for([
    { reply: "5.0.14", version: "5.0.14" },
    { reply: null, version: "unknown" },
  ])(
    "migrateToLatest rejects Redis $version as below the minimum version",
    async ({ reply, version }, { setup }) => {
      await using stateAdapter = setup.createStateAdapterReportingVersion(reply);

      await expect(stateAdapter.migrateToLatest()).rejects.toThrow(
        `Unsupported Redis version ${version}: Queuert needs 6 or later`,
      );
      expect(await setup.client.keys(`${setup.keyPrefix}*`)).toEqual([]);
    },
  );

  it.for(["6.0.0", "7.2.4", "8.0.2"])(
    "migrateToLatest accepts Redis %s",
    async (version, { setup }) => {
      await using stateAdapter = setup.createStateAdapterReportingVersion(version);

      await expect(stateAdapter.migrateToLatest()).resolves.toBeDefined();
    },
  );
});
