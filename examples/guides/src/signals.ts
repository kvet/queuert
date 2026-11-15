import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

const jobTypes = defineJobTypes<{
  /*
   * process-batch (stops early when the worker stops; output records how far it got)
   */
  "process-batch": {
    entry: true;
    input: { items: string[] };
    output: { processed: number };
  };

  /*
   * await-payment-confirmation (polls the provider; a webhook may complete it first)
   */
  "await-payment-confirmation": {
    entry: true;
    input: { paymentId: string };
    output: { confirmedBy: "poll" | "webhook" };
  };
}>();

const { promise: batchStarted, resolve: onBatchStarted } = Promise.withResolvers<void>();
const { promise: pollingStarted, resolve: onPollingStarted } = Promise.withResolvers<void>();
const processItem = async (_item: string) => delay(10);
const pollPaymentProvider = async (_paymentId: string) => delay(10).then(() => false);

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      // #region partial-results
      "process-batch": {
        attemptHandler: async ({ signal, job, complete }) => {
          // #hide
          onBatchStarted();
          // #endhide
          let processed = 0;
          for (const item of job.input.items) {
            if (signal.aborted) break;
            await processItem(item);
            processed++;
          }
          return stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, output: { processed } }),
          );
        },
      },
      // #endregion
      // #region polling-handler
      "await-payment-confirmation": {
        attemptHandler: async ({ signal, job, complete }) => {
          // #hide
          onPollingStarted();
          // #endhide
          while (!signal.aborted) {
            if (await pollPaymentProvider(job.input.paymentId)) {
              return stateAdapter.withTransaction(async (txCtx) =>
                complete({ ...txCtx, output: { confirmedBy: "poll" } }),
              );
            }
          }
          throw signal.reason;
        },
      },
      // #endregion
    },
  }),
});
await workerRunner.start();

const payment = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "await-payment-confirmation",
    input: { paymentId: "payment-1" },
  }),
);
await pollingStarted;

// #region external-completion
await stateAdapter.withTransaction(async (txCtx) =>
  client.completeChain({
    ...txCtx,
    typeName: "await-payment-confirmation",
    id: payment.id,
    handler: async ({ job, completeJob }) => {
      await completeJob(job, async ({ complete }) =>
        complete({ output: { confirmedBy: "webhook" } }),
      );
    },
  }),
);
// #endregion
const confirmedPayment = await client.awaitChain(payment, { timeoutMs: 5000 });
assert.equal(confirmedPayment.output.confirmedBy, "webhook");

const items = Array.from({ length: 1000 }, (_, index) => `item-${index}`);
const batch = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "process-batch", input: { items } }),
);
await batchStarted;
await delay(50);
await workerRunner.stop();

const batchResult = await client.awaitChain(batch, { timeoutMs: 5000 });
assert.ok(batchResult.output.processed > 0 && batchResult.output.processed < items.length);
