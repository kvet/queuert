import { createProcessors, withTxHooks } from "queuert";

import { sql } from "./adapters.ts";
import { client } from "./client.ts";
import { notificationJobTypes } from "./slice-notifications-definitions.ts";

export const notificationProcessors = createProcessors({
  client,
  jobTypes: notificationJobTypes,
  processors: {
    "notifications.send-notification": {
      attemptHandler: async ({ job, complete }) => {
        console.log(
          `[notifications.send-notification] Sending ${job.input.channel} to user ${job.input.userId}: "${job.input.message}"`,
        );

        return withTxHooks(async (txHooks) =>
          sql.begin(async (txSql) =>
            complete({ txSql, txHooks, output: { sentAt: new Date().toISOString() } }),
          ),
        );
      },
    },
  },
});
