import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { createRedisNotifyAdapter, RedisNotifyProvider } from "@queuert/redis";
import { createConsoleLog, createQueuert } from "queuert";
import { Db, DbTransaction } from "./db.js";
import { qrtJobDefinitions } from "./qrt-schema.js";
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
  const stateProvider: PgStateProvider<{ tx: DbTransaction }, { db: Db }> = {
    provideContext: async (cb) => cb({ db }),
    isInTransaction: async (ctx) => "tx" in ctx,
    runInTransaction: async (ctx, cb) => {
      return ctx.db.transaction(async (tx) => cb({ tx }));
    },
    executeSql: async (ctx, query, params) => {
      // Inside transaction: access Drizzle's internal pg client
      // Outside transaction (migrations): use db.$client (the pool)
      const client = "tx" in ctx ? (ctx.tx as any).session.client : (db as any).$client;
      const result = await client.query(query, params);
      return result.rows;
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
