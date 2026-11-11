// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { detectResourceLeaks } from "@queuert/helpers/testing";
import { TESTCONTAINERS_RESOURCE_TYPES, acquireRedis } from "@queuert/testcontainers";
import { notifyAdapterEndToEndGroups } from "queuert/conformance-internal";
import { type RedisClientType, createClient } from "redis";
import { it as baseIt, describe } from "vitest";

import {
  createRedisNotifyProviderConformanceContext,
  redisNotifyProviderConformanceGroups,
} from "../conformance/notify-provider-conformance.ts";
import { createNodeRedisNotifyProvider } from "./notify-provider.node-redis.ts";

const redis = await acquireRedis("redis:6");

const it = baseIt
  .extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
    const client = createClient({ url: redis.connectionUrl }) as RedisClientType;
    const subscribeClient = createClient({ url: redis.connectionUrl }) as RedisClientType;
    await client.connect();
    await subscribeClient.connect();
    onCleanup(async () => {
      await client.close();
      await subscribeClient.close();
    });
    return createRedisNotifyProviderConformanceContext({
      createNotifyProvider: async () => createNodeRedisNotifyProvider({ client, subscribeClient }),
    });
  })
  .extend(
    "resourceLeakCheck",
    { auto: true },
    detectResourceLeaks({ additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES }),
  );

// NOTE: hack for vitest plugin
baseIt("index");

describe("Redis Notify Provider Conformance", () => {
  conformanceTestSuite({
    it,
    groups: [...redisNotifyProviderConformanceGroups, ...notifyAdapterEndToEndGroups],
  });
});
