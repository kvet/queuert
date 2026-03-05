import { type InProcessWorkerProcessors, type JobTypeRegistryDefinitions } from "queuert";
import { type stateAdapter } from "./adapters.js";
import { type orderJobTypes } from "./slice-orders-definitions.js";

export const orderProcessors = {
  "orders.create-order": {
    attemptHandler: async ({ job, complete }) => {
      const totalAmount = job.input.items.reduce((sum, item) => sum + item.price, 0);
      console.log(
        `[orders.create-order] User ${job.input.userId} ordered ${job.input.items.length} items ($${totalAmount.toFixed(2)})`,
      );

      return complete(async ({ continueWith }) =>
        continueWith({
          typeName: "orders.fulfill-order",
          input: { orderId: 1001, totalAmount },
        }),
      );
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
} satisfies InProcessWorkerProcessors<
  typeof stateAdapter,
  JobTypeRegistryDefinitions<typeof orderJobTypes>
>;
