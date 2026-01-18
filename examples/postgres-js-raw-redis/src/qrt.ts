import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { createRedisNotifyAdapter, RedisNotifyProvider } from "@queuert/redis";
import { createConsoleLog, createQueuert } from "queuert";
import { qrtJobTypeDefinitions } from "./qrt-schema.js";
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
  const stateProvider: PgStateProvider<{ sql: TransactionSql }> = {
    runInTransaction: async (cb) => {
      let result: any;
      await sql.begin(async (txSql) => {
        result = await cb({ sql: txSql as TransactionSql });
      });
      return result;
    },
    executeSql: async ({ txContext, sql: query, params }) => {
      const sqlClient = txContext?.sql ?? sql;
      const normalizedParams = params
        ? (params as any[]).map((p) => (p === undefined ? null : p))
        : [];
      const result = await sqlClient.unsafe(query, normalizedParams);
      return result as any;
    },
  };
  const stateAdapter = await createPgStateAdapter({
    stateProvider,
    schema: "public",
  });

  await stateAdapter.migrateToLatest();

  const notifyProvider: RedisNotifyProvider = {
    publish: async (channel, message) => {
      await redis.publish(channel, message);
    },
    subscribe: async (channel, onMessage) => {
      await redisSubscription.subscribe(channel, onMessage);
      return async () => {
        await redisSubscription.unsubscribe(channel);
      };
    },
    eval: async (script, keys, args) => {
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
    jobTypeRegistry: qrtJobTypeDefinitions,
  });
};

export type Qrt = Awaited<ReturnType<typeof createQrt>>;
