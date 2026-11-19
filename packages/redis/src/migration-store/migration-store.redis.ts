import type { Migration, MigrationStore } from "@queuert/typed-sql";

import type { RedisStoreContext } from "../state-adapter/redis-transaction.ts";
import type { IndexedJob, RedisSchema } from "../state-adapter/schema.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";
import { rewriteConsecutiveFailures } from "./consecutive-failures.redis.ts";

const ACQUIRE_LOCK_SCRIPT = `
return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) and 1 or 0
`;

const EXTEND_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
end
return 1
`;

export const createRedisSchemaMigrations = ({
  schema,
  stateProvider,
  withTransaction,
}: {
  schema: RedisSchema;
  stateProvider: RedisStateProvider;
  withTransaction: <T>(fn: (txCtx: RedisStoreContext) => Promise<T>) => Promise<T>;
}): Migration<RedisStoreContext>[] => {
  const { keys } = schema;
  return [
    {
      name: "001_schema_fence_v1",
      up: async ({ transaction }) => {
        transaction.sadd(keys.schemaFences, "1");
      },
      down: async ({ transaction }) => {
        transaction.srem(keys.schemaFences, "1");
      },
    },
    {
      name: "002_schema_v2",
      type: "non-transactional",
      up: async ({ assertLockHeld }) => {
        await withTransaction(async ({ transaction }) => {
          transaction.srem(keys.schemaFences, "1");
        });
        const chainIds = await withTransaction(async ({ transaction }) => [
          ...(await transaction.counterEntries(keys.blockerReferences)).keys(),
        ]);
        for (let start = 0; start < chainIds.length; start += 500) {
          assertLockHeld();
          await withTransaction(async ({ transaction }) => {
            const headKeys = chainIds.slice(start, start + 500).map(keys.job);
            for (const [index, value] of (await transaction.getRecords(headKeys)).entries()) {
              const head = value as IndexedJob | undefined;
              if (head === undefined || head.chainIndex !== 0 || head.blocking) continue;
              const flagged = { ...head, blocking: true };
              transaction.putRecord(headKeys[index], flagged);
              const indexed = new Set(
                schema.jobIndexEntries(head).zsets.map(([key, member]) => `${key}\n${member}`),
              );
              for (const [key, member, score] of schema.jobIndexEntries(flagged).zsets) {
                if (!indexed.has(`${key}\n${member}`)) transaction.zadd(key, member, score);
              }
            }
          });
        }
        await rewriteConsecutiveFailures({ stateProvider, schema, assertLockHeld });
        await withTransaction(async ({ transaction }) => {
          transaction.sadd(keys.schemaFences, "2");
        });
      },
      down: async () => {
        throw new Error("The Queuert schema cannot be reverted.");
      },
    },
  ];
};

export const createRedisMigrationStore = ({
  stateProvider,
  withTransaction,
  migrationsKey,
  migrationLockKey,
}: {
  stateProvider: RedisStateProvider;
  withTransaction: <T>(fn: (txCtx: RedisStoreContext) => Promise<T>) => Promise<T>;
  migrationsKey: string;
  migrationLockKey: string;
}): MigrationStore<RedisStoreContext> => {
  const inTransaction = async <T>(
    txCtx: RedisStoreContext | undefined,
    fn: (txCtx: RedisStoreContext) => Promise<T>,
  ): Promise<T> => (txCtx === undefined ? withTransaction(fn) : fn(txCtx));

  return {
    runInTransaction: withTransaction,
    getAppliedMigrationNames: async (txCtx) =>
      inTransaction(txCtx, async ({ transaction }) =>
        (await transaction.smembers(migrationsKey, { validate: true })).toSorted(),
      ),
    recordMigration: async (txCtx, name) =>
      inTransaction(txCtx, async ({ transaction }) => {
        transaction.sadd(migrationsKey, name);
      }),
    unrecordMigration: async (txCtx, name) =>
      inTransaction(txCtx, async ({ transaction }) => {
        transaction.srem(migrationsKey, name);
      }),
    acquireMigrationLock: async (ownerId, ttlMs) =>
      Number(
        await stateProvider.eval(ACQUIRE_LOCK_SCRIPT, [migrationLockKey], [ownerId, String(ttlMs)]),
      ) === 1,
    extendMigrationLock: async (ownerId, ttlMs) =>
      Number(
        await stateProvider.eval(EXTEND_LOCK_SCRIPT, [migrationLockKey], [ownerId, String(ttlMs)]),
      ) === 1,
    releaseMigrationLock: async (ownerId) => {
      await stateProvider.eval(RELEASE_LOCK_SCRIPT, [migrationLockKey], [ownerId]);
    },
  };
};
