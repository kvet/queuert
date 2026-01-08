import { ObjectId } from "mongodb";
import { DbConnection } from "./db.js";
import { Qrt } from "./qrt.js";

export const createQrtWorker = async ({
  qrt,
  dbConnection,
}: {
  qrt: Qrt;
  dbConnection: DbConnection;
}) => {
  const worker = qrt.createWorker().implementJobType({
    typeName: "add_pet_to_user",
    process: async ({ job, complete }) => {
      return complete(async () => {
        const result = await dbConnection.pets.insertOne({
          owner_id: new ObjectId(job.input.userId),
          name: job.input.petName,
        });

        return { petId: result.insertedId.toHexString() };
      });
    },
  });

  return worker;
};
