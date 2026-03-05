/**
 * Slices Showcase
 *
 * Demonstrates how to organize job types and processors into feature slices,
 * then merge them into a single client and worker.
 *
 * Each slice defines:
 * - Job type definitions (defineJobTypes)
 * - Processor handlers (InProcessWorkerProcessors)
 *
 * Slices are composed at the application level using mergeJobTypeRegistries
 * and mergeJobTypeProcessors.
 */

import {
  createClient,
  createInProcessWorker,
  mergeJobTypeProcessors,
  mergeJobTypeRegistries,
  withTransactionHooks,
} from "queuert";

import { type DbContext, notifyAdapter, sql, stateAdapter, stopContainer } from "./adapters.js";
import { notificationJobTypes } from "./slice-notifications-definitions.js";
import { notificationProcessors } from "./slice-notifications-processors.js";
import { orderJobTypes } from "./slice-orders-definitions.js";
import { orderProcessors } from "./slice-orders-processors.js";

const registry = mergeJobTypeRegistries(orderJobTypes, notificationJobTypes);

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

const worker = await createInProcessWorker({
  client,
  processors: mergeJobTypeProcessors(orderProcessors, notificationProcessors),
});

const stopWorker = await worker.start();

console.log("\n--- Order Slice ---\n");

const orderChain = await withTransactionHooks(async (transactionHooks) =>
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

const orderResult = await client.awaitJobChain(orderChain, { timeoutMs: 10000 });
console.log(
  `\nOrder completed: #${orderResult.output.orderId} at ${orderResult.output.fulfilledAt}`,
);

console.log("\n--- Notification Slice ---\n");

const notificationChain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as DbContext["sql"];
    return client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "notifications.send-notification",
      input: {
        userId: "user-42",
        channel: "email",
        message: "Your order has been fulfilled!",
      },
    });
  }),
);

const notificationResult = await client.awaitJobChain(notificationChain, { timeoutMs: 10000 });
console.log(`\nNotification sent at ${notificationResult.output.sentAt}`);

await stopWorker();
await stopContainer();
