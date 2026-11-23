import { createProcessors } from "queuert";

import { client, stateAdapter } from "./client.ts";
import { notificationJobTypes } from "./slice-notifications-definitions.ts";

export const notificationProcessors = createProcessors({
  client,
  jobTypes: notificationJobTypes,
  processors: {
    "notifications.send-notification": {
      attemptHandler: async ({ applyJobOutcome }) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          applyJobOutcome({ ...txCtx, output: { sentAt: new Date().toISOString() } }),
        );
      },
    },
  },
});
