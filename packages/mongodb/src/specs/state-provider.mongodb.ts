import { type ClientSession, type Db, type MongoClient } from "mongodb";
import { type MongoStateProvider } from "../state-provider/state-provider.mongodb.js";

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
    getCollection: () => {
      return collection;
    },
    runInTransaction: async (fn) => {
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
