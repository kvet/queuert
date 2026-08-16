/**
 * Error Handling Showcase
 *
 * Demonstrates error handling patterns in Queuert chains.
 *
 * Scenarios:
 * 1. Discriminated Unions: Success/failure represented in typed outputs
 * 2. Compensation Pattern: Failed job continues to rollback/refund job
 * 3. Automatic Backoff: Transient errors retry with exponential backoff
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
   * Workflow (backoff):
   *   call-flaky-api <--+ (throw → automatic exponential backoff)
   *        |            |
   *        +------------+
   *        |
   *        v (success)
   *   output { data }
   */
  "call-flaky-api": {
    entry: true;
    input: { endpoint: string };
    output: { data: string };
  };
}>();

// Simulation state
let shipmentShouldFail = false;

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
            return complete(async ({ finish }) =>
              finish({ output: { success: false, error: "Amount exceeds limit" } }),
            );
          }

          console.log(`  Payment SUCCESS`);
          return complete(async ({ finish }) =>
            finish({ output: { success: true, transactionId: `txn_${Date.now()}` } }),
          );
        },
      },

      "charge-card": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[charge-card] Charging $${job.input.amount} for order ${job.input.orderId}`);
          const chargeId = `ch_${Date.now()}`;
          console.log(`  Charge successful: ${chargeId}`);

          return complete(async ({ finish }) =>
            finish({
              continueWith: {
                typeName: "ship-order",
                input: { orderId: job.input.orderId, chargeId },
              },
            }),
          );
        },
      },

      "ship-order": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[ship-order] Shipping order ${job.input.orderId}`);

          if (shipmentShouldFail) {
            console.log(`  Shipping FAILED - continuing to refund`);
            return complete(async ({ finish }) =>
              finish({
                continueWith: {
                  typeName: "refund-charge",
                  input: { chargeId: job.input.chargeId, reason: "shipping_failed" },
                },
              }),
            );
          }

          console.log(`  Shipping SUCCESS`);
          return complete(async ({ finish }) => finish({ output: { shipped: true } }));
        },
      },

      "refund-charge": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[refund-charge] Refunding ${job.input.chargeId} (${job.input.reason})`);
          const refundId = `rf_${Date.now()}`;
          console.log(`  Refund successful: ${refundId}`);
          return complete(async ({ finish }) => finish({ output: { refunded: true, refundId } }));
        },
      },

      "call-flaky-api": {
        backoffConfig: { initialDelayMs: 200, maxDelayMs: 1000 },
        attemptHandler: async ({ job, complete }) => {
          console.log(
            `[call-flaky-api] Attempt ${job.attempt} to ${job.input.endpoint}` +
              (job.lastAttemptError != null ? ` (previous: ${job.lastAttemptError})` : ""),
          );

          if (job.attempt < 3) {
            throw new Error(`Service unavailable (attempt ${job.attempt})`);
          }

          console.log(`  API call SUCCESS`);
          return complete(async ({ finish }) =>
            finish({ output: { data: `Response from ${job.input.endpoint}` } }),
          );
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
    const result = await client.createChain({
      txSql,
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
    const result = await client.createChain({
      txSql,
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
    const result = await client.createChain({
      txSql,
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
    const result = await client.createChain({
      txSql,
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

// Scenario 3: Automatic backoff on transient errors
console.log("\n--- Scenario 3: Automatic Backoff ---");
console.log(
  "Thrown errors reschedule with exponential backoff. lastAttemptError carries context.\n",
);

const apiCall = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const result = await client.createChain({
      txSql,
      transactionHooks,
      typeName: "call-flaky-api",
      input: { endpoint: "/api/data" },
    });
    return result;
  }),
);
const apiResult = await client.awaitChain(apiCall, { timeoutMs: 10000 });
console.log(`Final output: ${JSON.stringify(apiResult.output)}`);
assert.ok("data" in apiResult.output);

await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
