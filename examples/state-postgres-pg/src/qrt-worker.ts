import { Pet } from "./db-schema.js";
import { Qrt } from "./qrt.js";

export const createQrtWorker = async ({ qrt }: { qrt: Qrt }) => {
  const worker = qrt.createWorker().implementJobType({
    typeName: "add_pet_to_user",
    process: async ({ job, complete }) => {
      return complete(async ({ poolClient }) => {
        const result = await poolClient.query<Pet>(
          "INSERT INTO pet (owner_id, name) VALUES ($1, $2) RETURNING *",
          [job.input.userId, job.input.petName],
        );

        return { petId: result.rows[0].id };
      });
    },
  });

  return worker;
};
