import { type Migration, type MigrationResult, createMigrator } from "@queuert/typed-sql";

import { createRedisMigrationStore } from "../migration-store/migration-store.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";
import { rewriteConsecutiveFailures } from "./consecutive-failures.redis.ts";
import type { RedisStoreContext } from "./redis-transaction.ts";
import {
  type IndexedJob,
  type RedisSchema,
  createRedisSchemaSnapshot,
} from "./state-schema.redis.ts";

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

export const migrateRedisSchemaToLatest = async ({
  schema,
  stateProvider,
  withTransaction,
}: {
  schema: RedisSchema;
  stateProvider: RedisStateProvider;
  withTransaction: <T>(fn: (txCtx: RedisStoreContext) => Promise<T>) => Promise<T>;
}): Promise<MigrationResult> => {
  const migrations = createRedisSchemaMigrations({ schema, stateProvider, withTransaction });
  const store = createRedisMigrationStore({
    stateProvider,
    withTransaction,
    migrationsKey: schema.keys.migrations,
    migrationLockKey: schema.keys.migrationLock,
  });
  const installSchema = createRedisSchemaSnapshot(schema);
  const installed: string[] = [];
  const result = await createMigrator({
    migrations,
    store,
    before: async () => {
      installed.push(
        ...(await store.runInTransaction(async (txCtx) => {
          if ((await store.getAppliedMigrationNames(txCtx)).length > 0) return [];
          await installSchema(txCtx);
          for (const { name } of migrations) await store.recordMigration(txCtx, name);
          return migrations.map(({ name }) => name);
        })),
      );
    },
  }).migrateToLatest();
  return {
    ...result,
    applied: [...installed, ...result.applied],
    skipped: result.skipped.filter((name) => !installed.includes(name)),
  };
};
