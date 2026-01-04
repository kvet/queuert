import { createQueuert } from "@queuert/core";
import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { createRedisNotifyAdapter, RedisNotifyProvider } from "@queuert/redis";
import assert from "assert";
import { CompiledQuery } from "kysely";
import { Db } from "./db.js";
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
  const stateProvider: PgStateProvider<{ db: Db }> = {
    provideContext: async (cb) => cb({ db }),
    assertInTransaction: async ({ db }) => {
      assert(db.isTransaction);
    },
    runInTransaction: async ({ db }, cb) => db.transaction().execute(async (db) => cb({ db })),
    executeSql: async ({ db }, sql, params) => {
      const result = await db.executeQuery(CompiledQuery.raw(sql, params));
      return result.rows;
    },
  };
  const stateAdapter = createPgStateAdapter({
    stateProvider,
    schema: "public",
  });

  await stateAdapter.migrateToLatest({ db });

  const notifyProvider: RedisNotifyProvider<{ redis: Redis }> = {
    provideContext: async (type, cb) => {
      if (type === "command") {
        return cb({ redis });
      }
      if (type === "subscribe") {
        return cb({ redis: redisSubscription });
      }
      if (type === "brpop") {
        const brpopClient = redis.duplicate();
        await brpopClient.connect();
        brpopClient.on("error", (err) => {
          console.error("Redis BRPOP Client Error", err);
        });
        try {
          return await cb({ redis: brpopClient });
        } finally {
          await brpopClient.close();
        }
      }
      throw new Error(`Unknown notify context type: ${type}`);
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
    lpush: async ({ redis }, queue, message) => {
      await redis.lPush(queue, message);
    },
    brpop: async ({ redis }, queues, timeoutMs) => {
      const result = await redis.brPop(queues, timeoutMs / 1000);
      return result ? { queue: result.key, message: result.element } : undefined;
    },
  };
  const notifyAdapter = await createRedisNotifyAdapter({
    provider: notifyProvider,
  });

  return createQueuert({
    stateAdapter,
    notifyAdapter,
    log: ({ level, message, args }) => {
      console[level](`[${level}] ${message}`, ...args);
    },
    jobTypeDefinitions: qrtJobDefinitions,
  });
};

export type Qrt = Awaited<ReturnType<typeof createQrt>>;
