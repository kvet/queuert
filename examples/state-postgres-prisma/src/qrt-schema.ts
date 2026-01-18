import { DefineJobTypes, defineJobTypes } from "queuert";

type QrtJobTypeDefinitions = DefineJobTypes<{
  add_pet_to_user: {
    entry: true;
    input: { userId: number; petName: string };
    output: { petId: number };
  };
}>;

export const qrtJobTypeDefinitions = defineJobTypes<QrtJobTypeDefinitions>();
