import { type ClientSession, type Db, MongoClient } from "mongodb";
import { MongoStateProvider } from "../state-provider/state-provider.mongodb.js";

export type MongoContext = {
  session?: ClientSession;
};

export const createMongoProvider = ({
  client,
  db,
  collectionName,
}: {
  client: MongoClient;
  db: Db;
  collectionName: string;
}): MongoStateProvider<MongoContext> => {
  const collection = db.collection(collectionName);

  return {
    provideContext: async (fn) => {
      return fn({});
    },
    getCollection: () => {
      return collection;
    },
    isInTransaction: async (context) => {
      return context.session?.inTransaction() === true;
    },
    runInTransaction: async (context, fn) => {
      // If already in a transaction, just run the function
      if (context.session?.inTransaction()) {
        return fn(context);
      }

      const session = client.startSession();
      try {
        return await session.withTransaction(async () => fn({ session }));
      } finally {
        await session.endSession();
      }
    },
  };
};

export type MongoProvider = MongoStateProvider<MongoContext>;
