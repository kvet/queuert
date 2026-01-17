import { DefineJobTypes, defineJobTypes } from "queuert";

type QrtJobTypeDefinitions = DefineJobTypes<{
  add_pet_to_user: {
    entry: true;
    input: { userId: string; petName: string };
    output: { petId: string };
  };
}>;

export const qrtJobTypeDefinitions = defineJobTypes<QrtJobTypeDefinitions>();
