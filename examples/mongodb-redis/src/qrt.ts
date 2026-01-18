import { createMongoStateAdapter, MongoStateProvider } from "@queuert/mongodb";
import { createRedisNotifyAdapter, RedisNotifyProvider } from "@queuert/redis";
import { ClientSession } from "mongodb";
import { createConsoleLog, createQueuert } from "queuert";
import { DbConnection } from "./db.js";
import { qrtJobTypeDefinitions } from "./qrt-schema.js";
import { Redis } from "./redis.js";

type MongoContext = {
  session: ClientSession;
};

export const createQrt = async ({
  dbConnection,
  redis,
  redisSubscription,
}: {
  dbConnection: DbConnection;
  redis: Redis;
  redisSubscription: Redis;
}) => {
  const { client, db } = dbConnection;
  const collectionName = "queuert_jobs";
  const collection = db.collection(collectionName);

  const stateProvider: MongoStateProvider<MongoContext> = {
    getCollection: () => collection,
    runInTransaction: async (cb) => {
      const session = client.startSession();
      try {
        return await session.withTransaction(async () => cb({ session }));
      } finally {
        await session.endSession();
      }
    },
  };
  const stateAdapter = await createMongoStateAdapter({
    stateProvider,
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
