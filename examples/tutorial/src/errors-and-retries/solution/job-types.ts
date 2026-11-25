import { defineJobTypes } from "queuert";

export const jobTypes = defineJobTypes<{
  "sync-to-crm": {
    entry: true;
    input: { contactId: string };
    output: { crmId: string };
  };
}>();
