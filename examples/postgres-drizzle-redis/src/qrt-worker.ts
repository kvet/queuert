import { pet } from "./db-schema.js";
import { Qrt } from "./qrt.js";

export const createQrtWorker = async ({ qrt }: { qrt: Qrt }) => {
  const worker = qrt.createWorker().implementJobType({
    typeName: "add_pet_to_user",
    process: async ({ job, complete }) => {
      return complete(async ({ tx }) => {
        const [result] = await tx
          .insert(pet)
          .values({
            ownerId: job.input.userId,
            name: job.input.petName,
          })
          .returning();

        return { petId: result.id };
      });
    },
  });

  return worker;
};
