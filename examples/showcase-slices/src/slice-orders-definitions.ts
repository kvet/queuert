import { type JobTypeRegistryDefinitions, defineJobTypes } from "queuert";
import { type notificationJobTypes } from "./slice-notifications-definitions.js";

export const orderJobTypes = defineJobTypes<
  {
    /*
     * Workflow (independent):
     *   orders.create-order --> orders.fulfill-order
     */
    "orders.create-order": {
      entry: true;
      input: { userId: string; items: { name: string; price: number }[] };
      continueWith: { typeName: "orders.fulfill-order" };
    };
    "orders.fulfill-order": {
      input: { orderId: number; totalAmount: number };
      output: { orderId: number; fulfilledAt: string };
    };
    /*
     * Workflow (cross-slice blockers):
     *   orders.place-order --+--> orders.confirm-order
     *   notifications.send-notification --+    (blocked by notification)
     *
     * External references let this slice declare a blocker from
     * the notifications slice without duplicating its type definition.
     */
    "orders.place-order": {
      entry: true;
      input: { userId: string; items: { name: string; price: number }[] };
      continueWith: { typeName: "orders.confirm-order" };
    };
    "orders.confirm-order": {
      input: { orderId: number; totalAmount: number };
      output: { orderId: number; confirmedAt: string };
      blockers: [{ typeName: "notifications.send-notification" }];
    };
  },
  JobTypeRegistryDefinitions<typeof notificationJobTypes>
>();
