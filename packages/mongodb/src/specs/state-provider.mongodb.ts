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
    getSession: (txContext) => txContext?.session,
    runInTransaction: async (fn) => {
      const session = client.startSession();
      try {
        session.startTransaction();
        const result = await fn({ session });
        await session.commitTransaction();
        return result;
      } catch (error) {
        await session.abortTransaction();
        throw error;
      } finally {
        await session.endSession();
      }
    },
  };
};

export type MongoProvider = MongoStateProvider<MongoContext>;
