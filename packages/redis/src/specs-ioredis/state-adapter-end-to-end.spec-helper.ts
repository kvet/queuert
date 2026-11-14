import { sleep } from "@queuert/helpers/sleep";
import type { Redis } from "ioredis";
import type { StateAdapter } from "queuert";
import {
  type EndToEndFlakyDbContext,
  createFlakyBatchGenerator,
} from "queuert/conformance-internal";

import { createRedisStateAdapter } from "../state-adapter/state-adapter.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";
import { createIoredisStateProvider } from "./state-provider.ioredis.ts";

const createFlakyStateAdapter = (
  stateProvider: RedisStateProvider,
  keyPrefix: string,
  fail: () => Promise<never>,
): StateAdapter<any, any, any, "async"> => {
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

export const createRedisEndToEndContext = (
  client: Redis,
  createNotifyAdapter?: EndToEndFlakyDbContext["createNotifyAdapter"],
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
