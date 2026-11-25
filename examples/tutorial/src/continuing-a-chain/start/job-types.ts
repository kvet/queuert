import { defineJobTypes } from "queuert";

export const jobTypes = defineJobTypes<{
  "provision-account": {
    entry: true;
    input: { userId: string };
    output: { accountId: string };
  };
  "send-welcome-email": {
    entry: true;
    input: { accountId: string };
    output: { sentAt: string };
  };
}>();
