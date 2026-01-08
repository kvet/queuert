import { MongoClient } from "mongodb";
import { User, Pet } from "./db-schema.js";

export const createDb = async ({ connectionString }: { connectionString: string }) => {
  const client = new MongoClient(connectionString);
  await client.connect();

  const dbName = new URL(connectionString).pathname.slice(1).split("?")[0];
  const db = client.db(dbName);

  // Create indexes for application collections
  await db.collection("users").createIndex({ name: 1 });
  await db.collection("pets").createIndex({ owner_id: 1 });

  return {
    client,
    db,
    users: db.collection<User>("users"),
    pets: db.collection<Pet>("pets"),
  };
};

export type DbConnection = Awaited<ReturnType<typeof createDb>>;
