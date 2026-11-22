import assert from "node:assert/strict";

import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

const jobTypes = defineJobTypes<{
  // #region union-types
  /*
   * process-payment --> output { success: true, transactionId } | { success: false, error }
   */
  "process-payment": {
    entry: true;
    input: { orderId: string; amountCents: number };
    output: { success: true; transactionId: string } | { success: false; error: string };
  };
  // #endregion
  // #region compensation-types
  /*
   * charge-card --> ship-order --> output { shipped }
   *                     |
   *                     +-- (carrier rejects) --> refund-charge --> output { refunded }
   */
  "charge-card": {
    entry: true;
    input: { orderId: string; amountCents: number };
    continueWith: { typeName: "ship-order" };
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
  // #endregion
  /*
   * fetch-exchange-rate <--+ (throw --> rescheduled with backoff)
   *        |               |
   *        +---------------+
   *        |
   *        v
   *   output { rate }
   */
  "fetch-exchange-rate": {
    entry: true;
    input: { currency: string };
    output: { rate: number };
  };
}>();

const carrierRejectedOrders = new Set(["order-4"]);
const rateProviderResponses: unknown[] = [
  new Error("rate provider unavailable"),
  { code: "RATE_LIMITED", retryAfterMs: 10 },
  1.08,
];
const fetchRate = async (_currency: string): Promise<number> => {
  const response = rateProviderResponses.shift();
  if (typeof response !== "number") throw response;
  return response;
};
const previousErrors: string[] = [];

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      // #region union-process
      "process-payment": {
        attemptHandler: async ({ job, applyOutcome }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            job.input.amountCents > 100_000
              ? applyOutcome({
                  ...txCtx,
                  output: { success: false, error: "Amount exceeds limit" },
                })
              : applyOutcome({
                  ...txCtx,
                  output: { success: true, transactionId: `txn-${job.input.orderId}` },
                }),
          ),
      },
      // #endregion
      "charge-card": {
        attemptHandler: async ({ job, applyOutcome }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            applyOutcome({
              ...txCtx,
              continueWith: {
                typeName: "ship-order",
                input: { orderId: job.input.orderId, chargeId: `ch-${job.input.orderId}` },
              },
            }),
          ),
      },
      // #region compensation-process
      "ship-order": {
        attemptHandler: async ({ job, applyOutcome }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            carrierRejectedOrders.has(job.input.orderId)
              ? applyOutcome({
                  ...txCtx,
                  continueWith: {
                    typeName: "refund-charge",
                    input: { chargeId: job.input.chargeId, reason: "carrier rejected the order" },
                  },
                })
              : applyOutcome({ ...txCtx, output: { shipped: true } }),
          ),
      },
      // #endregion
      "refund-charge": {
        attemptHandler: async ({ job, applyOutcome }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            applyOutcome({
              ...txCtx,
              output: { refunded: true, refundId: `rf-${job.input.chargeId}` },
            }),
          ),
      },
      // #region rescheduling
      "fetch-exchange-rate": {
        backoffConfig: { initialDelayMs: 10, maxDelayMs: 1000 },
        attemptHandler: async ({ job, applyOutcome }) => {
          if (job.lastAttemptError !== null) {
            previousErrors.push(job.lastAttemptError);
          }

          const rate = await fetchRate(job.input.currency);

          return stateAdapter.withTransaction(async (txCtx) =>
            applyOutcome({ ...txCtx, output: { rate } }),
          );
        },
      },
      // #endregion
    },
  }),
});
await workerRunner.start();

// #region union-await
const paymentChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "process-payment",
    input: { orderId: "order-2", amountCents: 150_000 },
  }),
);
const payment = await client.awaitChain({ chain: paymentChain, timeoutMs: 5000 });
const paymentStatus = payment.output.success
  ? `paid with ${payment.output.transactionId}`
  : `declined: ${payment.output.error}`;
// #endregion
assert.equal(paymentStatus, "declined: Amount exceeds limit");

const acceptedPaymentChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "process-payment",
    input: { orderId: "order-1", amountCents: 50_000 },
  }),
);
const acceptedPayment = await client.awaitChain({ chain: acceptedPaymentChain, timeoutMs: 5000 });
assert.deepEqual(acceptedPayment.output, { success: true, transactionId: "txn-order-1" });

const [shippedOrder, refundedOrder] = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChains({
    ...txCtx,
    items: [
      { typeName: "charge-card", input: { orderId: "order-3", amountCents: 10_000 } },
      { typeName: "charge-card", input: { orderId: "order-4", amountCents: 10_000 } },
    ],
  }),
);
const shipped = await client.awaitChain({ chain: shippedOrder, timeoutMs: 5000 });
assert.deepEqual(shipped.output, { shipped: true });
const refunded = await client.awaitChain({ chain: refundedOrder, timeoutMs: 5000 });
assert.deepEqual(refunded.output, { refunded: true, refundId: "rf-ch-order-4" });

const rateChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "fetch-exchange-rate", input: { currency: "EUR" } }),
);
const rate = await client.awaitChain({ chain: rateChain, timeoutMs: 5000 });
assert.equal(rate.output.rate, 1.08);
assert.equal(previousErrors.length, 2);
assert.match(previousErrors[0], /^Error: rate provider unavailable\n\s+at /);
assert.equal(previousErrors[1], '{"code":"RATE_LIMITED","retryAfterMs":10}');
