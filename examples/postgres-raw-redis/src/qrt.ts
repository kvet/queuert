import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { createRedisNotifyAdapter, RedisNotifyProvider } from "@queuert/redis";
import { PoolClient } from "pg";
import { createConsoleLog, createQueuert } from "queuert";
import { Db } from "./db.js";
import { qrtJobTypeDefinitions } from "./qrt-schema.js";
import { Redis } from "./redis.js";

export type DbContext = { poolClient: PoolClient };

export const createQrt = async ({
  db,
  redis,
  redisSubscription,
}: {
  db: Db;
  redis: Redis;
  redisSubscription: Redis;
}) => {
  const stateProvider: PgStateProvider<DbContext> = {
    provideContext: async (cb) => {
      const poolClient = await db.connect();
      try {
        return await cb({ poolClient });
      } finally {
        poolClient.release();
      }
    },
    isInTransaction: async () => true,
    runInTransaction: async ({ poolClient }, cb) => {
      await poolClient.query("BEGIN");
      try {
        const result = await cb({ poolClient });
        await poolClient.query("COMMIT");
        return result;
      } catch (error) {
        await poolClient.query("ROLLBACK").catch(() => {});
        throw error;
      }
    },
    executeSql: async ({ poolClient }, sql, params) => {
      const result = await poolClient.query(sql, params);
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
    jobTypeRegistry: qrtJobTypeDefinitions,
  });
};

export type Qrt = Awaited<ReturnType<typeof createQrt>>;
