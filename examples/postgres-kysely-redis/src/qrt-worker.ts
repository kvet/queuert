import { Qrt } from "./qrt.js";

export const createQrtWorker = async ({ qrt }: { qrt: Qrt }) => {
  const worker = qrt.createWorker().implementJobType({
    typeName: "add_pet_to_user",
    process: async ({ job, complete }) => {
      return complete(async ({ db }) => {
        const result = await db
          .insertInto("pet")
          .values({
            owner_id: job.input.userId,
            name: job.input.petName,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        return { petId: result.id };
      });
    },
  });

  return worker;
};
