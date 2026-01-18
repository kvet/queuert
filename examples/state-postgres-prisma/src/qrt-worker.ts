import { Qrt } from "./qrt.js";

export const createQrtWorker = async ({ qrt }: { qrt: Qrt }) => {
  const worker = qrt.createWorker().implementJobType({
    typeName: "add_pet_to_user",
    process: async ({ job, complete }) => {
      return complete(async ({ prisma }) => {
        const result = await prisma.pet.create({
          data: {
            ownerId: job.input.userId,
            name: job.input.petName,
          },
        });

        return { petId: result.id };
      });
    },
  });

  return worker;
};
