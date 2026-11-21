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
} from "../conformance/state-provider-conformance.ts";
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
  return createRedisStateProviderConformanceContext({
    createStateProvider: async () => createIoredisStateProvider({ client }),
    stateAdapterOptions: { countCap: 3 },
  });
});

const customOptionsIt = baseIt.extend(
  "conformance",
  { scope: "file" },
  async ({}, { onCleanup }) => {
    const client = new Redis(redis.connectionUrl);
    onCleanup(async () => {
      await client.quit();
    });
    return createRedisStateProviderConformanceContext({
      createStateProvider: async () => createIoredisStateProvider({ client }),
      stateAdapterOptions: {
        generateJobId: () => `job.${crypto.randomUUID()}`,
        generateWorkerId: () => `worker.${crypto.randomUUID()}`,
      },
    });
  },
);

// NOTE: hack for vitest plugin
baseIt("index");

describe("Redis State Provider Conformance (ioredis)", () => {
  conformanceTestSuite({ it, groups: redisStateProviderConformanceGroups });
});

describe("Redis State Adapter Conformance (ioredis) - Concurrent Transactions", () => {
  conformanceTestSuite({
    it,
    groups: stateAdapterConcurrentTransactionGroups,
  });
});

describe("Redis State Provider Conformance (ioredis) - Custom Options", () => {
  conformanceTestSuite({ it: customOptionsIt, groups: redisStateProviderConformanceGroups });
});

describe("Redis State Adapter Conformance (ioredis) - Count Cap", () => {
  conformanceTestSuite({ it: cappedIt, groups: stateAdapterCountCapGroups });
});
