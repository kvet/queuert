import { defineJobTypeProcessorRegistry } from "queuert";
import { client } from "./client.js";
import { orderJobTypes } from "./slice-orders-definitions.js";

export const orderProcessorRegistry = defineJobTypeProcessorRegistry(client, orderJobTypes, {
  "orders.create-order": {
    attemptHandler: async ({ job, complete }) => {
      const totalAmount = job.input.items.reduce((sum, item) => sum + item.price, 0);
      console.log(
        `[orders.create-order] User ${job.input.userId} ordered ${job.input.items.length} items ($${totalAmount.toFixed(2)})`,
      );

      return complete(async ({ continueWith, sql, transactionHooks }) => {
        await client.startJobChain({
          sql,
          transactionHooks,
          typeName: "notifications.send-notification",
          input: {
            userId: job.input.userId,
            channel: "email",
            message: `Order received: ${job.input.items.length} items ($${totalAmount.toFixed(2)})`,
          },
        });

        return continueWith({
          typeName: "orders.fulfill-order",
          input: { orderId: 1001, totalAmount },
        });
      });
    },
  },

  "orders.fulfill-order": {
    attemptHandler: async ({ job, complete }) => {
      console.log(
        `[orders.fulfill-order] Fulfilling order #${job.input.orderId} ($${job.input.totalAmount.toFixed(2)})`,
      );

      return complete(async () => ({
        orderId: job.input.orderId,
        fulfilledAt: new Date().toISOString(),
      }));
    },
  },

  "orders.place-order": {
    attemptHandler: async ({ job, complete }) => {
      const totalAmount = job.input.items.reduce((sum, item) => sum + item.price, 0);
      console.log(
        `[orders.place-order] User ${job.input.userId} placed order ($${totalAmount.toFixed(2)})`,
      );

      return complete(async ({ continueWith, sql, transactionHooks }) => {
        const notifyChain = await client.startJobChain({
          sql,
          transactionHooks,
          typeName: "notifications.send-notification",
          input: {
            userId: job.input.userId,
            channel: "email",
            message: `Your order ($${totalAmount.toFixed(2)}) is being processed`,
          },
        });

        return continueWith({
          typeName: "orders.confirm-order",
          input: { orderId: 2001, totalAmount },
          blockers: [notifyChain],
        });
      });
    },
  },

  "orders.confirm-order": {
    attemptHandler: async ({ job, complete }) => {
      const notificationResult = job.blockers[0].output;
      console.log(
        `[orders.confirm-order] Notification sent at ${notificationResult.sentAt}, confirming order #${job.input.orderId}`,
      );

      return complete(async () => ({
        orderId: job.input.orderId,
        confirmedAt: new Date().toISOString(),
      }));
    },
  },
});
