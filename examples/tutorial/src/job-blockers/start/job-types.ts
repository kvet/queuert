import { defineJobTypes } from "queuert";

export const jobTypes = defineJobTypes<{
  "capture-payment": {
    entry: true;
    input: { orderId: string };
    output: { paymentId: string };
  };
  "reserve-stock": {
    entry: true;
    input: { orderId: string };
    output: { reservationId: string };
  };
  "ship-order": {
    entry: true;
    input: { orderId: string };
    output: { trackingNumber: string };
  };
}>();
