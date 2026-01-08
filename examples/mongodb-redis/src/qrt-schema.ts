import { DefineJobTypeDefinitions, defineUnionJobTypes } from "queuert";

export type QrtJobDefinitions = DefineJobTypeDefinitions<{
  add_pet_to_user: {
    input: { userId: string; petName: string };
    output: { petId: string };
  };
}>;

export const qrtJobDefinitions = defineUnionJobTypes<QrtJobDefinitions>();
