import type { LessonRun } from "../lesson.ts";

export const check = ({ logs }: LessonRun): void => {
  const shipped = logs.indexOf("Shipping order-1");
  const paid = logs.indexOf("Captured the payment for order-1");
  const reserved = logs.indexOf("Reserved the stock for order-1");
  if (shipped === -1) throw new Error("ship-order should run.");
  if (paid === -1 || reserved === -1 || shipped < paid || shipped < reserved) {
    throw new Error(
      "The order shipped before its payment and stock were done. Make capture-payment and reserve-stock blockers of ship-order.",
    );
  }
};
