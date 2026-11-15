import { createProcessors } from "queuert";

import { client, stateAdapter } from "./client.ts";
import { orderJobTypes } from "./slice-orders-definitions.ts";

export const orderProcessors = createProcessors({
  client,
  jobTypes: orderJobTypes,
  processors: {
    "orders.place-order": {
      attemptHandler: async ({ job, complete }) =>
        stateAdapter.withTransaction(async (txCtx) => {
          const notificationChain = await client.createChain({
            ...txCtx,
            typeName: "notifications.send-notification",
            input: { userId: job.input.userId, message: `Order ${job.input.orderId} received` },
          });
          return complete({
            ...txCtx,
            continueWith: {
              typeName: "orders.confirm-order",
              input: { orderId: job.input.orderId },
              blockers: [notificationChain],
            },
          });
        }),
    },
    "orders.confirm-order": {
      attemptHandler: async ({ job, complete }) => {
        const [notification] = job.blockers;
        return stateAdapter.withTransaction(async (txCtx) =>
          complete({ ...txCtx, output: { confirmedAt: notification.output.sentAt } }),
        );
      },
    },
  },
});
