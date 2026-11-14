// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import {
  endToEndAsyncGroups,
  endToEndBaseGroups,
  endToEndNotifyGroups,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import { createRedisNotifyAdapter } from "../notify-adapter/notify-adapter.redis.ts";
import { createIoredisNotifyProvider } from "./notify-provider.ioredis.ts";
import { createRedisEndToEndContext } from "./state-adapter-end-to-end.spec-helper.ts";

const redis = await acquireRedis("redis:6");

const it = baseIt
  .extend("client", { scope: "file" }, async ({}, { onCleanup }) => {
    const client = new Redis(redis.connectionUrl);
    onCleanup(async () => {
      await client.quit();
    });
    return client;
  })
  .extend("conformance", { scope: "file" }, async ({ client }, { onCleanup }) => {
    const subscribeClient = new Redis(redis.connectionUrl);
    onCleanup(async () => {
      await subscribeClient.quit();
    });
    return createRedisEndToEndContext(client, async () =>
      createRedisNotifyAdapter({
        notifyProvider: createIoredisNotifyProvider({ client, subscribeClient }),
        channelPrefix: `queuert-${crypto.randomUUID()}`,
      }),
    );
  });

// NOTE: hack for vitest plugin
baseIt("index");

describe("Redis End-to-End Conformance (ioredis), Redis notify", () => {
  conformanceTestSuite({
    it,
    groups: [...endToEndBaseGroups, ...endToEndAsyncGroups, ...endToEndNotifyGroups],
  });
});
