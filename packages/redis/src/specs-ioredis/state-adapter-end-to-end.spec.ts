// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { sleep } from "@queuert/helpers/sleep";
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import type { NotifyAdapter, StateAdapter } from "queuert";
import {
  type EndToEndFlakyDbContext,
  createFlakyBatchGenerator,
  endToEndBaseGroups,
  endToEndConcurrentTransactionGroups,
  endToEndFlakyDbConcurrentTransactionGroups,
  endToEndFlakyDbGroups,
  endToEndNotifyGroups,
  noopNotifyAdapter,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import { withoutLockWaitCases } from "../conformance/state-provider-conformance.ts";
import { createRedisNotifyAdapter } from "../notify-adapter/notify-adapter.redis.ts";
import { createRedisStateAdapter } from "../state-adapter/state-adapter.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";
import { createIoredisNotifyProvider } from "./notify-provider.ioredis.ts";
import { createIoredisStateProvider } from "./state-provider.ioredis.ts";

const redis = await acquireRedis("redis:6");

const createFlakyStateAdapter = (
  stateProvider: RedisStateProvider,
  keyPrefix: string,
  fail: () => Promise<never>,
): StateAdapter<any, any, any> => {
  const shouldError = createFlakyBatchGenerator();
  let enabled = true;
  let scriptCount = 0;
  let errorCount = 0;
  const stateAdapter = createRedisStateAdapter({
    stateProvider: {
      eval: async (script, keys, args) => {
        scriptCount++;
        if (enabled && shouldError()) {
          errorCount++;
          return fail();
        }
        return stateProvider.eval(script, keys, args);
      },
    },
    keyPrefix,
  });
  const close = async (): Promise<void> => {
    enabled = false;
    await sleep(50);
    await stateAdapter.close();
    if (scriptCount > 5 && errorCount === 0) {
      throw new Error(`the flaky provider failed none of its ${scriptCount} scripts`);
    }
  };
  return { ...stateAdapter, close, [Symbol.asyncDispose]: close };
};

const createRedisEndToEndContext = (
  client: Redis,
  createNotifyAdapter?: () => Promise<NotifyAdapter>,
): EndToEndFlakyDbContext => {
  const stateProvider = createIoredisStateProvider({ client });
  const keyPrefix = `{queuert-${crypto.randomUUID()}}:`;
  const createStateAdapter = async () => {
    await client.eval(
      "for _, key in ipairs(redis.call('KEYS', ARGV[1])) do redis.call('DEL', key) end",
      0,
      `${keyPrefix}*`,
    );
    const stateAdapter = createRedisStateAdapter({ stateProvider, keyPrefix });
    await stateAdapter.migrateToLatest();
    return stateAdapter;
  };
  return {
    createStateAdapter,
    withNonTransactionContext: async (fn) => {
      const stateAdapter = createRedisStateAdapter({ stateProvider, keyPrefix });
      await stateAdapter.migrateToLatest();
      return fn(await stateAdapter.withTransaction(async (txCtx) => txCtx));
    },
    createNotifyAdapter,
    createFlakyDbStateAdapter: async () => {
      await createRedisStateAdapter({ stateProvider, keyPrefix }).migrateToLatest();
      return createFlakyStateAdapter(stateProvider, keyPrefix, async () => {
        throw new Error("ERR Error running script: simulated script failure");
      });
    },
    createFlakyConnectionStateAdapter: async () => {
      await createRedisStateAdapter({ stateProvider, keyPrefix }).migrateToLatest();
      return createFlakyStateAdapter(stateProvider, keyPrefix, async () => {
        const error = new Error("connection reset") as Error & { code: string };
        error.code = "ECONNRESET";
        throw error;
      });
    },
  };
};

const it = baseIt.extend("client", { scope: "file" }, async ({}, { onCleanup }) => {
  const client = new Redis(redis.connectionUrl);
  onCleanup(async () => {
    await client.quit();
  });
  return client;
});

const noopNotifyIt = it.extend("conformance", { scope: "file" }, async ({ client }) =>
  createRedisEndToEndContext(client, async () => noopNotifyAdapter),
);

const redisNotifyIt = it.extend(
  "conformance",
  { scope: "file" },
  async ({ client }, { onCleanup }) => {
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
  },
);

const capabilityGroups = [
  ...withoutLockWaitCases(endToEndConcurrentTransactionGroups),
  ...endToEndFlakyDbGroups,
  ...endToEndFlakyDbConcurrentTransactionGroups,
];

// NOTE: hack for vitest plugin
baseIt("index");

describe("Redis End-to-End Conformance (ioredis), noop notify", () => {
  conformanceTestSuite({ it: noopNotifyIt, groups: [...endToEndBaseGroups, ...capabilityGroups] });
});

describe("Redis End-to-End Conformance (ioredis), Redis notify", () => {
  conformanceTestSuite({
    it: redisNotifyIt,
    groups: [...endToEndBaseGroups, ...endToEndNotifyGroups],
  });
});
