/**
 * Slices Showcase
 *
 * Demonstrates how to organize job types and processors into feature slices,
 * then merge them into a single client and worker.
 *
 * Patterns:
 * 1. Independent slices — each slice runs in isolation
 * 2. Fire-and-forget — processor starts a chain from another slice as a side-effect
 * 3. Cross-slice blockers — external references let one slice declare blockers from another
 */

import {
  createInProcessWorker,
  mergeJobTypeProcessorRegistries,
  withTransactionHooks,
} from "queuert";

import { type DbContext, sql, stopContainer } from "./adapters.js";
import { client } from "./client.js";
import { notificationProcessorRegistry } from "./slice-notifications-processors.js";
import { orderProcessorRegistry } from "./slice-orders-processors.js";

const worker = await createInProcessWorker({
  client,
  processorRegistry: mergeJobTypeProcessorRegistries(
    orderProcessorRegistry,
    notificationProcessorRegistry,
  ),
});

const stopWorker = await worker.start();

// ---------------------------------------------------------------------------
// Pattern 1: Independent slices
// Each slice runs in isolation — no cross-slice interaction.
// ---------------------------------------------------------------------------

console.log("\n--- Pattern 1: Independent Slices ---\n");

const orderChain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as DbContext["sql"];
    return client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "orders.create-order",
      input: {
        userId: "user-10",
        items: [{ name: "Widget", price: 9.99 }],
      },
    });
  }),
);

const orderResult = await client.awaitJobChain(orderChain, { timeoutMs: 10000 });
console.log(`Order completed: #${orderResult.output.orderId} at ${orderResult.output.fulfilledAt}`);

// ---------------------------------------------------------------------------
// Pattern 2: Fire-and-forget
// The order processor starts a notification as a side-effect within its
// complete callback. The notification runs independently — the order chain
// doesn't wait for it.
// ---------------------------------------------------------------------------

console.log("\n--- Pattern 2: Fire-and-forget ---\n");

const orderChain2 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as DbContext["sql"];
    return client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "orders.create-order",
      input: {
        userId: "user-42",
        items: [
          { name: "Widget", price: 9.99 },
          { name: "Gadget", price: 24.99 },
        ],
      },
    });
  }),
);

const orderResult2 = await client.awaitJobChain(orderChain2, { timeoutMs: 10000 });
console.log(
  `Order completed: #${orderResult2.output.orderId} at ${orderResult2.output.fulfilledAt}`,
);
console.log("(A notification was fired in the background by the create-order processor)");

// ---------------------------------------------------------------------------
// Pattern 3: Cross-slice blockers with external references
// The orders slice references notifications.send-notification as a blocker
// using defineJobTypes<T, TExternal>. No need for a separate workflow slice
// that duplicates the notification type definition.
//
// place-order starts a notification chain and passes it as a blocker
// to confirm-order via continueWith. confirm-order won't run until the
// notification completes.
// ---------------------------------------------------------------------------

console.log("\n--- Pattern 3: Cross-slice Blockers ---\n");

const placeOrderChain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as DbContext["sql"];
    return client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "orders.place-order",
      input: {
        userId: "user-42",
        items: [
          { name: "Premium Widget", price: 49.99 },
          { name: "Deluxe Gadget", price: 79.99 },
        ],
      },
    });
  }),
);

const placeOrderResult = await client.awaitJobChain(placeOrderChain, { timeoutMs: 10000 });
console.log(
  `Order confirmed: #${placeOrderResult.output.orderId} at ${placeOrderResult.output.confirmedAt}`,
);

await stopWorker();
await stopContainer();
