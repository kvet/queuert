// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import { notifyAdapterEndToEndGroups } from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import {
  createRedisNotifyProviderConformanceContext,
  redisNotifyProviderConformanceGroups,
} from "../conformance/notify-provider-conformance.ts";
import { createIoredisNotifyProvider } from "./notify-provider.ioredis.ts";

const redis = await acquireRedis("redis:6");

const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const client = new Redis(redis.connectionUrl);
  const subscribeClient = new Redis(redis.connectionUrl);
  onCleanup(async () => {
    await client.quit();
    await subscribeClient.quit();
  });
  return createRedisNotifyProviderConformanceContext({
    createNotifyProvider: async () => createIoredisNotifyProvider({ client, subscribeClient }),
  });
});

// NOTE: hack for vitest plugin
baseIt("index");

describe("Redis Notify Provider Conformance (ioredis)", () => {
  conformanceTestSuite({
    it,
    groups: [...redisNotifyProviderConformanceGroups, ...notifyAdapterEndToEndGroups],
  });
});
