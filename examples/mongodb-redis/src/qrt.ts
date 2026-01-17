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
    provideContext: async (cb) => {
      const session = client.startSession();
      try {
        return await cb({ session });
      } finally {
        await session.endSession();
      }
    },
    getCollection: () => collection,
    isInTransaction: async (context) => context.session.inTransaction(),
    runInTransaction: async (context, cb) => {
      return context.session.withTransaction(async (session) => cb({ session }));
    },
  };

  const stateAdapter = await createMongoStateAdapter({
    stateProvider,
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
