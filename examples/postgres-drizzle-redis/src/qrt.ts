import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { createRedisNotifyAdapter, RedisNotifyProvider } from "@queuert/redis";
import { createConsoleLog, createQueuert } from "queuert";
import { Db, DbTransaction } from "./db.js";
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
  const stateProvider: PgStateProvider<{ tx: DbTransaction }> = {
    runInTransaction: async (cb) => {
      return db.transaction(async (tx) => cb({ tx }));
    },
    executeSql: async ({ txContext, sql, params }) => {
      // Inside transaction: access Drizzle's internal pg client
      // Outside transaction (migrations): use db.$client (the pool)
      const client = txContext ? (txContext.tx as any).session.client : (db as any).$client;
      const result = await client.query(sql, params);
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
