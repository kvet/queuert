import { DefineJobTypeDefinitions, defineUnionJobTypes } from "queuert";

export type QrtJobDefinitions = DefineJobTypeDefinitions<{
  add_pet_to_user: {
    input: { userId: number; petName: string };
    output: { petId: number };
  };
}>;

export const qrtJobDefinitions = defineUnionJobTypes<QrtJobDefinitions>();
