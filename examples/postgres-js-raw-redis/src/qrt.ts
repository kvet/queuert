import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { createRedisNotifyAdapter, RedisNotifyProvider } from "@queuert/redis";
import { createConsoleLog, createQueuert } from "queuert";
import { qrtJobDefinitions } from "./qrt-schema.js";
import { Redis } from "./redis.js";
import { Sql, TransactionSql } from "./sql.js";

export const createQrt = async ({
  sql,
  redis,
  redisSubscription,
}: {
  sql: Sql;
  redis: Redis;
  redisSubscription: Redis;
}) => {
  const stateProvider: PgStateProvider<{ sql: TransactionSql }, { sql: Sql }> = {
    provideContext: async (cb) => cb({ sql }),
    isInTransaction: async () => true,
    runInTransaction: async ({ sql }, cb) => {
      let result: any;
      await sql.begin(async (sql) => {
        result = await cb({ sql: sql as TransactionSql });
      });
      return result;
    },
    executeSql: async ({ sql }, query, params) => {
      const normalizedParams = params
        ? (params as any[]).map((p) => (p === undefined ? null : p))
        : [];
      const result = await sql.unsafe(query, normalizedParams);
      return result as any;
    },
  };
  const stateAdapter = await createPgStateAdapter({
    stateProvider,
    schema: "public",
  });

  await stateAdapter.migrateToLatest();

  const notifyProvider: RedisNotifyProvider<{ redis: Redis }> = {
    provideContext: async (type, cb) => {
      switch (type) {
        case "command":
          return cb({ redis });
        case "subscribe":
          return cb({ redis: redisSubscription });
      }
    },
    publish: async ({ redis }, channel, message) => {
      await redis.publish(channel, message);
    },
    subscribe: async ({ redis }, channel, onMessage) => {
      await redis.subscribe(channel, onMessage);
      return async () => {
        await redis.unsubscribe(channel);
      };
    },
    eval: async ({ redis }, script, keys, args) => {
      return redis.eval(script, { keys, arguments: args });
    },
  };
  const notifyAdapter = await createRedisNotifyAdapter({
    provider: notifyProvider,
  });

  return createQueuert({
    stateAdapter,
    notifyAdapter,
    log: createConsoleLog(),
    jobTypeDefinitions: qrtJobDefinitions,
  });
};

export type Qrt = Awaited<ReturnType<typeof createQrt>>;
