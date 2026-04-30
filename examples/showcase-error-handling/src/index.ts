/**
 * Error Handling Showcase
 *
 * Demonstrates error handling patterns in Queuert chains.
 *
 * Scenarios:
 * 1. Discriminated Unions: Success/failure represented in typed outputs
 * 2. Compensation Pattern: Failed job continues to rollback/refund job
 * 3. Explicit Rescheduling: Rate-limited API calls with rescheduleJob
 */

import assert from "node:assert/strict";

import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  rescheduleJob,
  withTransactionHooks,
} from "queuert";

const jobTypes = defineJobTypes<{
  /*
   * Workflow (discriminated union):
   *   process-payment --> output { success } | { error }
   */
  "process-payment": {
    entry: true;
    input: { orderId: string; amount: number };
    output: { success: true; transactionId: string } | { success: false; error: string };
  };

  /*
   * Workflow (compensation):
   *   charge-card
   *        |
   *        v
   *   ship-order ---> output { shipped } (success)
   *        |
   *        v (failure)
   *   refund-charge --> output { refunded }
   */
  "charge-card": {
    entry: true;
    input: { orderId: string; amount: number };
    continueWith: { typeName: "ship-order" | "refund-charge" };
  };
  "ship-order": {
    input: { orderId: string; chargeId: string };
    output: { shipped: true };
    continueWith: { typeName: "refund-charge" };
  };
  "refund-charge": {
    input: { chargeId: string; reason: string };
    output: { refunded: true; refundId: string };
  };

  /*
   * Workflow (rescheduling):
   *   call-rate-limited-api <--+ (reschedule on rate limit)
   *        |                   |
   *        +-------------------+
   *        |
   *        v (success)
   *   output { data }
   */
  "call-rate-limited-api": {
    entry: true;
    input: { endpoint: string };
    output: { data: string };
  };
}>();

// Simulation state
let shipmentShouldFail = false;
let apiRateLimited = true;

await using pg = await acquirePostgres("postgres:18", import.meta.url);
const sql = postgres(pg.connectionString, { max: 10 });

const stateProvider = createPostgresJsStateProvider({ sql });
const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
const notifyProvider = createPostgresJsNotifyProvider({ sql });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "process-payment": {
        attemptHandler: async ({ job, complete }) => {
          console.log(
            `[process-payment] Processing $${job.input.amount} for order ${job.input.orderId}`,
          );

          if (job.input.amount > 1000) {
            console.log(`  Payment FAILED: Amount exceeds limit`);
            return complete(async () => ({ success: false, error: "Amount exceeds limit" }));
          }

          console.log(`  Payment SUCCESS`);
          return complete(async () => ({ success: true, transactionId: `txn_${Date.now()}` }));
        },
      },

      "charge-card": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[charge-card] Charging $${job.input.amount} for order ${job.input.orderId}`);
          const chargeId = `ch_${Date.now()}`;
          console.log(`  Charge successful: ${chargeId}`);

          return complete(async ({ continueWith }) =>
            continueWith({
              typeName: "ship-order",
              input: { orderId: job.input.orderId, chargeId },
            }),
          );
        },
      },

      "ship-order": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[ship-order] Shipping order ${job.input.orderId}`);

          if (shipmentShouldFail) {
            console.log(`  Shipping FAILED - continuing to refund`);
            return complete(async ({ continueWith }) =>
              continueWith({
                typeName: "refund-charge",
                input: { chargeId: job.input.chargeId, reason: "shipping_failed" },
              }),
            );
          }

          console.log(`  Shipping SUCCESS`);
          return complete(async () => ({ shipped: true }));
        },
      },

      "refund-charge": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[refund-charge] Refunding ${job.input.chargeId} (${job.input.reason})`);
          const refundId = `rf_${Date.now()}`;
          console.log(`  Refund successful: ${refundId}`);
          return complete(async () => ({ refunded: true, refundId }));
        },
      },

      "call-rate-limited-api": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[call-rate-limited-api] Attempt ${job.attempt} to ${job.input.endpoint}`);

          if (apiRateLimited && job.attempt < 3) {
            console.log(`  Rate limited! Rescheduling in 100ms...`);
            rescheduleJob({ afterMs: 100 });
          }

          console.log(`  API call SUCCESS`);
          return complete(async () => ({ data: `Response from ${job.input.endpoint}` }));
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// Scenario 1: Discriminated union outputs
console.log("\n--- Scenario 1: Discriminated Union Outputs ---");
console.log("Payment results are typed as success | failure.\n");

const payment1 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const result = await client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "process-payment",
      input: { orderId: "order-1", amount: 500 },
    });
    return result;
  }),
);
const result1 = await client.awaitChain(payment1, { timeoutMs: 5000 });
console.log(
  `Result: ${result1.output.success ? `SUCCESS (${result1.output.transactionId})` : `FAILED (${result1.output.error})`}`,
);
assert.equal(result1.output.success, true);

const payment2 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const result = await client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "process-payment",
      input: { orderId: "order-2", amount: 1500 },
    });
    return result;
  }),
);
const result2 = await client.awaitChain(payment2, { timeoutMs: 5000 });
console.log(
  `Result: ${result2.output.success ? `SUCCESS (${result2.output.transactionId})` : `FAILED (${result2.output.error})`}`,
);
assert.equal(result2.output.success, false);

// Scenario 2: Compensation pattern - success path
console.log("\n--- Scenario 2a: Compensation Pattern (Success) ---");
console.log("Charge -> Ship succeeds.\n");

shipmentShouldFail = false;
const order1 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const result = await client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "charge-card",
      input: { orderId: "order-3", amount: 100 },
    });
    return result;
  }),
);
const orderResult1 = await client.awaitChain(order1, { timeoutMs: 5000 });
console.log(`Final output: ${JSON.stringify(orderResult1.output)}`);
assert.ok("shipped" in orderResult1.output);

// Scenario 2: Compensation pattern - failure path
console.log("\n--- Scenario 2b: Compensation Pattern (Failure -> Refund) ---");
console.log("Charge -> Ship fails -> Refund.\n");

shipmentShouldFail = true;
const order2 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const result = await client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "charge-card",
      input: { orderId: "order-4", amount: 100 },
    });
    return result;
  }),
);
const orderResult2 = await client.awaitChain(order2, { timeoutMs: 5000 });
console.log(`Final output: ${JSON.stringify(orderResult2.output)}`);
assert.ok("refunded" in orderResult2.output);

// Scenario 3: Explicit rescheduling
console.log("\n--- Scenario 3: Explicit Rescheduling ---");
console.log("API is rate-limited, job reschedules itself.\n");

apiRateLimited = true;
const apiCall = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const result = await client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "call-rate-limited-api",
      input: { endpoint: "/api/data" },
    });
    return result;
  }),
);
const apiResult = await client.awaitChain(apiCall, { timeoutMs: 5000 });
console.log(`Final output: ${JSON.stringify(apiResult.output)}`);
assert.ok("data" in apiResult.output);

await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
