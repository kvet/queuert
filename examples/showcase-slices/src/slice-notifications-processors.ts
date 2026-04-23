import { createProcessors } from "queuert";

import { client } from "./client.js";
import { notificationJobTypes } from "./slice-notifications-definitions.js";

export const notificationProcessors = createProcessors({
  client,
  jobTypes: notificationJobTypes,
  processors: {
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
  },
});
