import { defineJobTypes } from "queuert";

export const orderJobTypes = defineJobTypes<{
  /*
   * Workflow:
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
}>();
