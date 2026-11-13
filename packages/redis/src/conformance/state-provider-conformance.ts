import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SchemaFenceConformanceContext,
  stateAdapterBaseGroups,
  stateAdapterSchemaFenceGroups,
  toConformanceTestCases,
} from "queuert/conformance-internal";

import { createRedisStateAdapter } from "../state-adapter/state-adapter.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";

/**
 * The context the {@link redisStateProviderConformanceCases} run against. Get it from
 * {@link createRedisStateProviderConformanceContext} and pass it to every case unchanged.
 *
 * @experimental
 */
export type RedisStateProviderConformanceContext = SchemaFenceConformanceContext & {
  createStateProvider: () => Promise<RedisStateProvider>;
  createStateAdapter: () => Promise<ReturnType<typeof createRedisStateAdapter>>;
};

/**
 * State adapter cases that assert a transaction waits on a row another transaction locked. The
 * Redis state adapter never waits: a transaction whose reads changed before it commits runs again,
 * so these cases do not apply to it.
 *
 * @experimental
 */
export const redisStateAdapterLockWaitCaseNames: ReadonlySet<string> = new Set([
  "getChains > lock: exclusive blocks a concurrent locked read until the holding tx commits",
  "getJobs > lock: exclusive blocks a concurrent locked read until the holding tx commits",
  "getWorkers > lock: exclusive blocks a concurrent locked read until the holding tx commits",
  "startJobAttempts > a claim waiting on a transaction that locks and deletes the worker claims nothing",
  "getJobs > lock: exclusive on a continuation also locks its chain head",
  "addJobsBlockers > reports a blocker chain deleted while it waited on the head lock as missing",
  "addJobsBlockers > reports a blocker chain continued while it waited on the head lock as incomplete",
  "addJobsBlockers > reports a blocker chain completed while it waited on the head lock as complete",
  "unblockJobs > unblocks a dependent whose blocker was added before the chain completed, without a caller pre-lock",
  "unblockJobs > leaves a dependent pending when its blocker completed before the blocker was added, without a caller pre-lock",
  "deleteChains > sees a blocker reference committed while it waited on the head lock",
  "deleteChains > deletes a continuation committed while it waited on the head lock",
]);

export const withoutLockWaitCases = <TContext>(
  groups: ConformanceGroup<TContext>[],
): ConformanceGroup<TContext>[] =>
  groups
    .map((group) => ({
      name: group.name,
      cases: group.cases.filter(
        (testCase) => !redisStateAdapterLockWaitCaseNames.has(`${group.name} > ${testCase.name}`),
      ),
    }))
    .filter((group) => group.cases.length > 0);

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

/**
 * Prepares the context the {@link redisStateProviderConformanceCases} run against: a Redis state
 * adapter per case over a new provider, under a key prefix of its own and migrated to the latest
 * schema. The test file still owns the provider's resources and releases them itself.
 *
 * @param options - Context configuration.
 *
 * @experimental
 */
export const createRedisStateProviderConformanceContext = ({
  createStateProvider,
}: {
  /**
   * Creates the provider under test. Each case's adapter gets its own provider and closes it when
   * the case ends, so closing one must not release resources the next one needs, such as the
   * client connection.
   */
  createStateProvider: () => Promise<RedisStateProvider>;
}): RedisStateProviderConformanceContext => {
  const keyPrefixes = new Set<string>();
  const createStateAdapter = async () => {
    const keyPrefix = `{queuert-conformance-${randomUUID()}}:`;
    keyPrefixes.add(keyPrefix);
    const stateAdapter = createRedisStateAdapter({
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
        await stateProvider.eval(FENCE_SCRIPT, [`${keyPrefix}schema-fences`], [action, "1"]);
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
    ...withoutLockWaitCases(stateAdapterBaseGroups),
    ...stateAdapterSchemaFenceGroups,
  ];

/**
 * The provider's `eval` contract followed by every state adapter contract case the Redis state
 * adapter meets, including the checks of its schema write fence, run through
 * `createRedisStateAdapter` over a provider. Run them one per test in your own test file against
 * a context from {@link createRedisStateProviderConformanceContext}. Works with any test runner.
 *
 * @example
 * ```ts
 * import { afterAll, test } from "vitest";
 *
 * const client = new Redis(url);
 * const context = createRedisStateProviderConformanceContext({
 *   createStateProvider: async () => createIoredisStateProvider({ client }),
 * });
 * afterAll(async () => {
 *   await client.quit();
 * });
 *
 * for (const conformanceCase of redisStateProviderConformanceCases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run(context);
 *   });
 * }
 * ```
 *
 * @experimental
 */
export const redisStateProviderConformanceCases: ConformanceTestCase<RedisStateProviderConformanceContext>[] =
  toConformanceTestCases<RedisStateProviderConformanceContext>(redisStateProviderConformanceGroups);
