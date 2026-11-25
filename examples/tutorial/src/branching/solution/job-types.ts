import { defineJobTypes } from "queuert";

export const jobTypes = defineJobTypes<{
  "triage-ticket": {
    entry: true;
    input: { ticketId: string; urgent: boolean };
    continueWith: { typeName: "page-on-call" | "queue-for-support" };
  };
  "page-on-call": {
    input: { ticketId: string };
    output: { handledBy: string };
  };
  "queue-for-support": {
    input: { ticketId: string };
    output: { handledBy: string };
  };
}>();
