import assert from "node:assert/strict";

import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

// #region types
const jobTypes = defineJobTypes<{
  /*
   * activate-trial --> trial-decision --+--> expire-trial
   *                                     |
   *                                     +--> charge-billing <--+
   *                                               |            |
   *                                               +---(loop)---+
   *                                               |
   *                                               +--> cancel-subscription
   */
  "activate-trial": {
    entry: true;
    input: { subscriptionId: string };
    continueWith: { typeName: "trial-decision" };
  };
  "trial-decision": {
    input: { subscriptionId: string };
    continueWith: { typeName: "charge-billing" | "expire-trial" };
  };
  "expire-trial": {
    input: { subscriptionId: string };
    output: { expired: true };
  };
  "charge-billing": {
    input: { subscriptionId: string; cycle: number };
    output: { cyclesCharged: number };
    continueWith: { typeName: "charge-billing" | "cancel-subscription" };
  };
  "cancel-subscription": {
    input: { subscriptionId: string; cyclesCharged: number };
    output: { cancelledAfterCycles: number };
  };
}>();
// #endregion

const billingCycles = 3;

type Subscription = {
  status: "created" | "trial" | "active" | "expired" | "ended" | "cancelled";
  cardOnFile: boolean;
  cancelRequested: boolean;
  cyclesCharged: number;
};
const subscriptions = new Map<string, Subscription>();

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      // #region linear
      "activate-trial": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          await stateAdapter.withTransaction(async (txCtx) => {
            subscriptions.get(job.input.subscriptionId)!.status = "trial";
            return applyJobOutcome({
              ...txCtx,
              continueWith: {
                typeName: "trial-decision",
                input: { subscriptionId: job.input.subscriptionId },
              },
            });
          });
        },
      },
      // #endregion
      // #region branched
      "trial-decision": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          await stateAdapter.withTransaction(async (txCtx) => {
            const subscription = subscriptions.get(job.input.subscriptionId)!;
            return applyJobOutcome({
              ...txCtx,
              continueWith: subscription.cardOnFile
                ? {
                    typeName: "charge-billing",
                    input: { subscriptionId: job.input.subscriptionId, cycle: 1 },
                  }
                : {
                    typeName: "expire-trial",
                    input: { subscriptionId: job.input.subscriptionId },
                  },
            });
          });
        },
      },
      // #endregion
      "expire-trial": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          await stateAdapter.withTransaction(async (txCtx) => {
            subscriptions.get(job.input.subscriptionId)!.status = "expired";
            return applyJobOutcome({ ...txCtx, output: { expired: true } });
          });
        },
      },
      // #region loop
      "charge-billing": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          await stateAdapter.withTransaction(async (txCtx) => {
            const subscription = subscriptions.get(job.input.subscriptionId)!;
            // #region go-to
            if (subscription.cancelRequested) {
              return applyJobOutcome({
                ...txCtx,
                continueWith: {
                  typeName: "cancel-subscription",
                  input: {
                    subscriptionId: job.input.subscriptionId,
                    cyclesCharged: subscription.cyclesCharged,
                  },
                },
              });
            }
            // #endregion
            subscription.status = "active";
            subscription.cyclesCharged = job.input.cycle;
            if (job.input.cycle < billingCycles) {
              return applyJobOutcome({
                ...txCtx,
                continueWith: {
                  typeName: "charge-billing",
                  input: { subscriptionId: job.input.subscriptionId, cycle: job.input.cycle + 1 },
                },
              });
            }
            subscription.status = "ended";
            return applyJobOutcome({ ...txCtx, output: { cyclesCharged: job.input.cycle } });
          });
        },
      },
      // #endregion
      "cancel-subscription": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          await stateAdapter.withTransaction(async (txCtx) => {
            subscriptions.get(job.input.subscriptionId)!.status = "cancelled";
            return applyJobOutcome({
              ...txCtx,
              output: { cancelledAfterCycles: job.input.cyclesCharged },
            });
          });
        },
      },
    },
  }),
});
await workerRunner.start();

const subscribe = async (subscriptionId: string, subscription: Subscription) =>
  stateAdapter.withTransaction(async (txCtx) => {
    subscriptions.set(subscriptionId, subscription);
    return client.createChain({ ...txCtx, typeName: "activate-trial", input: { subscriptionId } });
  });

const paidChain = await subscribe("subscription-1", {
  status: "created",
  cardOnFile: true,
  cancelRequested: false,
  cyclesCharged: 0,
});
const paid = await client.awaitChain({ chain: paidChain, timeoutMs: 5000 });
assert.deepEqual(paid.output, { cyclesCharged: 3 });
assert.equal(subscriptions.get("subscription-1")!.status, "ended");

const expiredChain = await subscribe("subscription-2", {
  status: "created",
  cardOnFile: false,
  cancelRequested: false,
  cyclesCharged: 0,
});
const expired = await client.awaitChain({ chain: expiredChain, timeoutMs: 5000 });
assert.deepEqual(expired.output, { expired: true });
assert.equal(subscriptions.get("subscription-2")!.status, "expired");

const cancelledChain = await subscribe("subscription-3", {
  status: "created",
  cardOnFile: true,
  cancelRequested: true,
  cyclesCharged: 0,
});
const cancelled = await client.awaitChain({ chain: cancelledChain, timeoutMs: 5000 });
assert.deepEqual(cancelled.output, { cancelledAfterCycles: 0 });
assert.equal(subscriptions.get("subscription-3")!.status, "cancelled");
