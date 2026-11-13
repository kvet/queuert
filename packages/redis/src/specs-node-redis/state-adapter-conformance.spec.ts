// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireRedis } from "@queuert/testcontainers";
import { type RedisClientType, createClient } from "redis";
import { it as baseIt, describe } from "vitest";

import {
  createRedisStateProviderConformanceContext,
  redisStateProviderConformanceGroups,
} from "../conformance/state-provider-conformance.ts";
import { createNodeRedisStateProvider } from "./state-provider.node-redis.ts";

const redis = await acquireRedis("redis:6");

const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const client = createClient({ url: redis.connectionUrl }) as RedisClientType;
  await client.connect();
  onCleanup(async () => {
    await client.close();
  });
  return createRedisStateProviderConformanceContext({
    createStateProvider: async () => createNodeRedisStateProvider({ client }),
  });
});

// NOTE: hack for vitest plugin
baseIt("index");

describe("Redis State Provider Conformance (node-redis)", () => {
  conformanceTestSuite({ mode: "async", it, groups: redisStateProviderConformanceGroups });
});
