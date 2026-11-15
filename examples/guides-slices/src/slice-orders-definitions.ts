import { type JobTypeDefinitions, defineJobTypes } from "queuert";

import type { notificationJobTypes } from "./slice-notifications-definitions.ts";

export const orderJobTypes = defineJobTypes<
  {
    /*
     * orders.place-order --------------+--> orders.confirm-order
     * notifications.send-notification -+
     */
    "orders.place-order": {
      entry: true;
      input: { orderId: string; userId: string };
      continueWith: { typeName: "orders.confirm-order" };
    };
    "orders.confirm-order": {
      input: { orderId: string };
      output: { confirmedAt: string };
      blockers: [{ typeName: "notifications.send-notification" }];
    };
  },
  JobTypeDefinitions<typeof notificationJobTypes>
>();
