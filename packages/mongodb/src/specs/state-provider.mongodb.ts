import { type ClientSession, type Db, MongoClient } from "mongodb";
import { MongoStateProvider } from "../state-provider/state-provider.mongodb.js";

export type MongoContext = {
  session: ClientSession;
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
      const session = client.startSession();
      try {
        return await fn({ session });
      } finally {
        await session.endSession();
      }
    },
    getCollection: () => {
      return collection;
    },
    isInTransaction: async (context) => {
      return context.session.inTransaction();
    },
    runInTransaction: async (context, fn) => {
      return context.session.withTransaction(async (session) => fn({ session }));
    },
  };
};

export type MongoProvider = MongoStateProvider<MongoContext>;
