// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import {
  endToEndAsyncGroups,
  endToEndBaseGroups,
  endToEndConcurrentTransactionGroups,
  endToEndFlakyDbConcurrentTransactionGroups,
  endToEndFlakyDbGroups,
  noopNotifyAdapter,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

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
  .extend("conformance", { scope: "file" }, async ({ client }) =>
    createRedisEndToEndContext(client, async () => noopNotifyAdapter),
  );

// NOTE: hack for vitest plugin
baseIt("index");

describe("Redis End-to-End Conformance (ioredis), noop notify", () => {
  conformanceTestSuite({
    it,
    groups: [
      ...endToEndBaseGroups,
      ...endToEndAsyncGroups,
      ...endToEndConcurrentTransactionGroups,
      ...endToEndFlakyDbGroups,
      ...endToEndFlakyDbConcurrentTransactionGroups,
    ],
  });
});
