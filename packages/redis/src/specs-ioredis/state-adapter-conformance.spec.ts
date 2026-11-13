// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import {
  stateAdapterConcurrentTransactionGroups,
  stateAdapterCountCapGroups,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import {
  createRedisStateProviderConformanceContext,
  redisStateProviderConformanceGroups,
  withoutLockWaitCases,
} from "../conformance/state-provider-conformance.ts";
import { createRedisStateAdapter } from "../state-adapter/state-adapter.redis.ts";
import { createIoredisStateProvider } from "./state-provider.ioredis.ts";

const redis = await acquireRedis("redis:6");

const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const client = new Redis(redis.connectionUrl);
  onCleanup(async () => {
    await client.quit();
  });
  return createRedisStateProviderConformanceContext({
    createStateProvider: async () => createIoredisStateProvider({ client }),
  });
});

const cappedIt = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const client = new Redis(redis.connectionUrl);
  onCleanup(async () => {
    await client.quit();
  });
  const createStateAdapter = async () => {
    const stateAdapter = createRedisStateAdapter({
      stateProvider: createIoredisStateProvider({ client }),
      keyPrefix: `{queuert-${crypto.randomUUID()}}:`,
      countCap: 3,
    });
    await stateAdapter.migrateToLatest();
    return stateAdapter;
  };
  return {
    createStateAdapter,
    withNonTransactionContext: async <T>(fn: (txCtx: any) => Promise<T>) => {
      const stateAdapter = await createStateAdapter();
      return fn(await stateAdapter.withTransaction(async (txCtx) => txCtx));
    },
  };
});

// NOTE: hack for vitest plugin
baseIt("index");

describe("Redis State Provider Conformance (ioredis)", () => {
  conformanceTestSuite({
    it,
    groups: redisStateProviderConformanceGroups,
  });
});

describe("Redis State Adapter Conformance (ioredis) - Concurrent Transactions", () => {
  conformanceTestSuite({
    it,
    groups: withoutLockWaitCases(stateAdapterConcurrentTransactionGroups),
  });
});

describe("Redis State Adapter Conformance (ioredis) - Count Cap", () => {
  conformanceTestSuite({ it: cappedIt, groups: stateAdapterCountCapGroups });
});
