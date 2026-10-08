import { createProcessors, withTransactionHooks } from "queuert";

import { sql } from "./adapters.js";
import { client } from "./client.js";
import { notificationJobTypes } from "./slice-notifications-definitions.js";

export const notificationProcessors = createProcessors({
  client,
  jobTypes: notificationJobTypes,
  processors: {
    "notifications.send-notification": {
      attemptHandler: async ({ job, finish }) => {
        console.log(
          `[notifications.send-notification] Sending ${job.input.channel} to user ${job.input.userId}: "${job.input.message}"`,
        );

        return withTransactionHooks(async (transactionHooks) =>
          sql.begin(async (txSql) =>
            finish({ txSql, transactionHooks, output: { sentAt: new Date().toISOString() } }),
          ),
        );
      },
    },
  },
});
