import { type InProcessWorkerProcessors, type JobTypeRegistryDefinitions } from "queuert";
import { type stateAdapter } from "./adapters.js";
import { type notificationJobTypes } from "./slice-notifications-definitions.js";

export const notificationProcessors = {
  "notifications.send-notification": {
    attemptHandler: async ({ job, complete }) => {
      console.log(
        `[notifications.send-notification] Sending ${job.input.channel} to user ${job.input.userId}: "${job.input.message}"`,
      );

      return complete(async () => ({
        sentAt: new Date().toISOString(),
      }));
    },
  },
} satisfies InProcessWorkerProcessors<
  typeof stateAdapter,
  JobTypeRegistryDefinitions<typeof notificationJobTypes>
>;
