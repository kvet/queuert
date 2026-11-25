import { defineJobTypes } from "queuert";

export const jobTypes = defineJobTypes<{
  "provision-account": {
    entry: true;
    input: { userId: string };
    continueWith: { typeName: "send-welcome-email" };
  };
  "send-welcome-email": {
    input: { accountId: string };
    output: { sentAt: string };
  };
}>();
