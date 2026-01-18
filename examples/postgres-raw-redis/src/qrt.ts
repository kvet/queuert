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
    runInTransaction: async (cb) => {
      const poolClient = await db.connect();
      try {
        await poolClient.query("BEGIN");
        const result = await cb({ poolClient });
        await poolClient.query("COMMIT");
        return result;
      } catch (error) {
        await poolClient.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        poolClient.release();
      }
    },
    executeSql: async ({ txContext, sql, params }) => {
      if (txContext) {
        const result = await txContext.poolClient.query(sql, params);
        return result.rows;
      }
      const poolClient = await db.connect();
      try {
        const result = await poolClient.query(sql, params);
        return result.rows;
      } finally {
        poolClient.release();
      }
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
