import { Qrt } from "./qrt.js";
import { Pet } from "./sql-schema.js";

export const createQrtWorker = async ({ qrt }: { qrt: Qrt }) => {
  const worker = qrt.createWorker().implementJobType({
    typeName: "add_pet_to_user",
    process: async ({ job, complete }) => {
      return complete(async ({ sql }) => {
        const [result] = await sql<Pet[]>`
          INSERT INTO pet (owner_id, name)
          VALUES (${job.input.userId}, ${job.input.petName})
          RETURNING *
        `;

        return { petId: result.id };
      });
    },
  });

  return worker;
};
