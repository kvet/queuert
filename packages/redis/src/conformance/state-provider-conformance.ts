import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SchemaFenceConformanceContext,
  stateAdapterAsyncGroups,
  stateAdapterBaseGroups,
  stateAdapterSchemaFenceGroups,
  toConformanceTestCases,
} from "queuert/conformance-internal";

import { SCHEMA_VERSION } from "../state-adapter/schema.redis.ts";
import { createRedisStateAdapter } from "../state-adapter/state-adapter.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";

export type RedisStateProviderConformanceContext = SchemaFenceConformanceContext & {
  createStateProvider: () => Promise<RedisStateProvider>;
  createStateAdapter: () => Promise<ReturnType<typeof createRedisStateAdapter>>;
};

const evalOnce = async (
  createStateProvider: () => Promise<RedisStateProvider>,
  script: string,
  keys: string[],
  args: string[],
): Promise<unknown> => {
  const stateProvider = await createStateProvider();
  try {
    return await stateProvider.eval(script, keys, args);
  } finally {
    await stateProvider.close?.();
  }
};

const FENCE_SCRIPT = `
if ARGV[1] == 'lift' then
  return redis.call('SADD', KEYS[1], ARGV[2])
end
return redis.call('SREM', KEYS[1], ARGV[2])
`;

const scratchKey = (): string => `{queuert-conformance-${randomUUID()}}:scratch`;

export const redisStateProviderEvalGroup: ConformanceGroup<RedisStateProviderConformanceContext> = {
  name: "RedisStateProvider.eval",
  cases: [
    {
      name: "returns an integer reply as a number",
      run: async ({ createStateProvider }) => {
        assert.equal(await evalOnce(createStateProvider, "return 42", [scratchKey()], []), 42);
      },
    },
    {
      name: "returns a bulk string reply as a string",
      run: async ({ createStateProvider }) => {
        assert.equal(
          await evalOnce(createStateProvider, "return ARGV[1]", [scratchKey()], ["héllo"]),
          "héllo",
        );
      },
    },
    {
      name: "returns an array reply in order, with Lua false as null",
      run: async ({ createStateProvider }) => {
        assert.deepEqual(
          await evalOnce(
            createStateProvider,
            "return { 1, false, 'a', { 2, 'b' } }",
            [scratchKey()],
            [],
          ),
          [1, null, "a", [2, "b"]],
        );
      },
    },
    {
      name: "returns an empty array reply as an empty array",
      run: async ({ createStateProvider }) => {
        assert.deepEqual(await evalOnce(createStateProvider, "return {}", [scratchKey()], []), []);
      },
    },
    {
      name: "passes keys and arguments in order",
      run: async ({ createStateProvider }) => {
        const key = scratchKey();
        assert.deepEqual(
          await evalOnce(
            createStateProvider,
            "return { KEYS[1], ARGV[1], ARGV[2], #ARGV }",
            [key],
            ["first", "second"],
          ),
          [key, "first", "second", 2],
        );
      },
    },
    {
      name: "passes thousands of arguments",
      run: async ({ createStateProvider }) => {
        const args = Array.from({ length: 5000 }, (_, index) => String(index));
        assert.equal(
          await evalOnce(createStateProvider, "return #ARGV", [scratchKey()], args),
          5000,
        );
      },
    },
    {
      name: "rejects with the script's error reply",
      run: async ({ createStateProvider }) => {
        await assert.rejects(
          evalOnce(
            createStateProvider,
            "return redis.error_reply('queuert conformance failure')",
            [scratchKey()],
            [],
          ),
          /queuert conformance failure/,
        );
      },
    },
    {
      name: "runs the same script again and a different script after it",
      run: async ({ createStateProvider }) => {
        const stateProvider = await createStateProvider();
        try {
          const key = scratchKey();
          const script = "return redis.call('INCR', KEYS[1])";
          assert.equal(await stateProvider.eval(script, [key], []), 1);
          assert.equal(await stateProvider.eval(script, [key], []), 2);
          assert.equal(
            await stateProvider.eval("return redis.call('GET', KEYS[1])", [key], []),
            "2",
          );
          await stateProvider.eval("return redis.call('DEL', KEYS[1])", [key], []);
        } finally {
          await stateProvider.close?.();
        }
      },
    },
  ],
};

export const createRedisStateProviderConformanceContext = ({
  createStateProvider,
  stateAdapterOptions,
}: Parameters<
  typeof createRedisStateProviderConformanceCases
>[0]): RedisStateProviderConformanceContext => {
  const keyPrefixes = new Set<string>();
  const createStateAdapter = async () => {
    const keyPrefix = `{queuert-conformance-${randomUUID()}}:`;
    keyPrefixes.add(keyPrefix);
    const stateAdapter = createRedisStateAdapter({
      ...stateAdapterOptions,
      stateProvider: await createStateProvider(),
      keyPrefix,
    });
    try {
      await stateAdapter.migrateToLatest();
    } catch (error) {
      await stateAdapter.close();
      throw error;
    }
    return stateAdapter;
  };
  const setFences = async (action: "drop" | "lift"): Promise<void> => {
    const stateProvider = await createStateProvider();
    try {
      for (const keyPrefix of keyPrefixes) {
        await stateProvider.eval(
          FENCE_SCRIPT,
          [`${keyPrefix}schema-fences`],
          [action, String(SCHEMA_VERSION)],
        );
      }
    } finally {
      await stateProvider.close?.();
    }
  };
  return {
    createStateProvider,
    createStateAdapter,
    withWritesFenced: async (fn) => {
      await setFences("drop");
      try {
        return await fn();
      } finally {
        await setFences("lift");
      }
    },
    withNonTransactionContext: async (fn) => {
      const stateAdapter = await createStateAdapter();
      try {
        return await fn(await stateAdapter.withTransaction(async (txCtx) => txCtx));
      } finally {
        await stateAdapter.close();
      }
    },
  };
};

export const redisStateProviderConformanceGroups: ConformanceGroup<RedisStateProviderConformanceContext>[] =
  [
    redisStateProviderEvalGroup,
    ...stateAdapterBaseGroups,
    ...stateAdapterAsyncGroups,
    ...stateAdapterSchemaFenceGroups,
  ];

/**
 * Prepares the state adapter contract cases for a provider, ready to run. The cases are the
 * provider's `eval` contract followed by every state adapter contract case the Redis state adapter
 * meets, including the checks of its schema write fence, run through `createRedisStateAdapter` over
 * a provider. Each case gets a Redis state adapter over a new provider, under a key prefix of its
 * own and migrated to the latest schema. The test file still owns the provider's resources and
 * releases them itself. Works with any test runner.
 *
 * @param options - Suite configuration.
 *
 * @example
 * ```ts
 * import { afterAll, test } from "vitest";
 *
 * const client = new Redis(url);
 * const cases = createRedisStateProviderConformanceCases({
 *   createStateProvider: async () => createIoredisStateProvider({ client }),
 * });
 * afterAll(async () => {
 *   await client.quit();
 * });
 *
 * for (const conformanceCase of cases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run();
 *   });
 * }
 * ```
 *
 * @experimental
 */
export const createRedisStateProviderConformanceCases = (options: {
  /**
   * Creates the provider under test. Each case's adapter gets its own provider and closes it when
   * the case ends, so closing one must not release resources the next one needs, such as the
   * client connection.
   */
  createStateProvider: () => Promise<RedisStateProvider>;
  /**
   * Options every adapter of the suite is created with, besides its provider and `keyPrefix`,
   * such as the ID generators your application configures. Each case still writes under a key
   * prefix of its own.
   */
  stateAdapterOptions?: Omit<
    Parameters<typeof createRedisStateAdapter>[0],
    "stateProvider" | "keyPrefix"
  >;
}): ConformanceTestCase[] =>
  toConformanceTestCases(
    redisStateProviderConformanceGroups,
    createRedisStateProviderConformanceContext(options),
  );
