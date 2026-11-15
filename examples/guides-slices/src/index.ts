import assert from "node:assert/strict";

import { createWorkerRunner } from "queuert";

import { client, stateAdapter } from "./client.ts";
import { notificationProcessors } from "./slice-notifications-processors.ts";
import { orderProcessors } from "./slice-orders-processors.ts";

// #region worker
await using workerRunner = createWorkerRunner({
  client,
  processors: [orderProcessors, notificationProcessors],
});
await workerRunner.start();
// #endregion

const orderChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "orders.place-order",
    input: { orderId: "order-1", userId: "user-1" },
  }),
);

const order = await client.awaitChain(orderChain, { timeoutMs: 5000 });
assert.ok(order.output.confirmedAt);
