import type { Migration, MigrationStore } from "@queuert/typed-sql/migrator";

import type { RedisStoreContext } from "../state-adapter/redis-transaction.ts";
import type { RedisSchema } from "../state-adapter/schema.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";

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
  keys,
}: RedisSchema): Migration<RedisStoreContext>[] => [
  {
    name: "001_schema_fence_v1",
    up: async ({ transaction }) => {
      transaction.sadd(keys.schemaFences, "1");
    },
    down: async ({ transaction }) => {
      transaction.srem(keys.schemaFences, "1");
    },
  },
];

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
