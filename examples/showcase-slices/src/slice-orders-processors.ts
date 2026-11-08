import { createProcessors, withTxHooks } from "queuert";

import { sql } from "./adapters.ts";
import { client } from "./client.ts";
import { orderJobTypes } from "./slice-orders-definitions.ts";

export const orderProcessors = createProcessors({
  client,
  jobTypes: orderJobTypes,
  processors: {
    "orders.create-order": {
      attemptHandler: async ({ job, complete }) => {
        const totalAmount = job.input.items.reduce((sum, item) => sum + item.price, 0);
        console.log(
          `[orders.create-order] User ${job.input.userId} ordered ${job.input.items.length} items ($${totalAmount.toFixed(2)})`,
        );

        return withTxHooks(async (txHooks) =>
          sql.begin(async (txSql) => {
            await client.createChain({
              txSql,
              txHooks,
              typeName: "notifications.send-notification",
              input: {
                userId: job.input.userId,
                channel: "email",
                message: `Order received: ${job.input.items.length} items ($${totalAmount.toFixed(2)})`,
              },
            });

            return complete({
              txSql,
              txHooks,
              continueWith: {
                typeName: "orders.fulfill-order",
                input: { orderId: 1001, totalAmount },
              },
            });
          }),
        );
      },
    },

    "orders.fulfill-order": {
      attemptHandler: async ({ job, complete }) => {
        console.log(
          `[orders.fulfill-order] Fulfilling order #${job.input.orderId} ($${job.input.totalAmount.toFixed(2)})`,
        );

        return withTxHooks(async (txHooks) =>
          sql.begin(async (txSql) =>
            complete({
              txSql,
              txHooks,
              output: {
                orderId: job.input.orderId,
                fulfilledAt: new Date().toISOString(),
              },
            }),
          ),
        );
      },
    },

    "orders.place-order": {
      attemptHandler: async ({ job, complete }) => {
        const totalAmount = job.input.items.reduce((sum, item) => sum + item.price, 0);
        console.log(
          `[orders.place-order] User ${job.input.userId} placed order ($${totalAmount.toFixed(2)})`,
        );

        return withTxHooks(async (txHooks) =>
          sql.begin(async (txSql) => {
            const notifyChain = await client.createChain({
              txSql,
              txHooks,
              typeName: "notifications.send-notification",
              input: {
                userId: job.input.userId,
                channel: "email",
                message: `Your order ($${totalAmount.toFixed(2)}) is being processed`,
              },
            });

            return complete({
              txSql,
              txHooks,
              continueWith: {
                typeName: "orders.confirm-order",
                input: { orderId: 2001, totalAmount },
                blockers: [notifyChain],
              },
            });
          }),
        );
      },
    },

    "orders.confirm-order": {
      attemptHandler: async ({ job, complete }) => {
        const [notification] = job.blockers;
        console.log(
          `[orders.confirm-order] Notification sent at ${notification.output.sentAt}, confirming order #${job.input.orderId}`,
        );

        return withTxHooks(async (txHooks) =>
          sql.begin(async (txSql) =>
            complete({
              txSql,
              txHooks,
              output: {
                orderId: job.input.orderId,
                confirmedAt: new Date().toISOString(),
              },
            }),
          ),
        );
      },
    },
  },
});
