import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { createRedisNotifyAdapter, RedisNotifyProvider } from "@queuert/redis";
import { CompiledQuery } from "kysely";
import { createConsoleLog, createQueuert } from "queuert";
import { Db } from "./db.js";
import { qrtJobTypeDefinitions } from "./qrt-schema.js";
import { Redis } from "./redis.js";

export const createQrt = async ({
  db,
  redis,
  redisSubscription,
}: {
  db: Db;
  redis: Redis;
  redisSubscription: Redis;
}) => {
  const stateProvider: PgStateProvider<{ db: Db }> = {
    runInTransaction: async (cb) => db.transaction().execute(async (txDb) => cb({ db: txDb })),
    executeSql: async ({ txContext, sql, params }) => {
      if (txContext && !txContext.db.isTransaction) {
        throw new Error("Provided context is not in a transaction");
      }
      const result = await (txContext?.db ?? db).executeQuery(CompiledQuery.raw(sql, params));
      return result.rows;
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
