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
   * import-records (stops early when the worker stops; output records how far it got)
   */
  "import-records": {
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

const { promise: importStarted, resolve: onImportStarted } = Promise.withResolvers<void>();
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
      "import-records": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          // #hide
          onImportStarted();
          // #endhide
          let processed = 0;
          for (const item of job.input.items) {
            if (job.signal.aborted) break;
            await processItem(item);
            processed++;
          }
          await stateAdapter.withTransaction(async (txCtx) =>
            applyJobOutcome({ ...txCtx, output: { processed } }),
          );
        },
      },
      // #endregion
      // #region polling-handler
      "await-payment-confirmation": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          // #hide
          onPollingStarted();
          // #endhide
          while (!job.signal.aborted) {
            if (await pollPaymentProvider(job.input.paymentId)) {
              await stateAdapter.withTransaction(async (txCtx) =>
                applyJobOutcome({ ...txCtx, output: { confirmedBy: "poll" } }),
              );
              return;
            }
          }
          throw job.signal.reason;
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
  client.applyJobOutcome({
    ...txCtx,
    job: { id: payment.id, typeName: "await-payment-confirmation" },
    output: { confirmedBy: "webhook" },
  }),
);
// #endregion
const confirmedPayment = await client.awaitChain({ chain: payment, timeoutMs: 5000 });
assert.equal(confirmedPayment.output.confirmedBy, "webhook");

const items = Array.from({ length: 1000 }, (_, index) => `item-${index}`);
const importChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "import-records", input: { items } }),
);
await importStarted;
await delay(50);
await workerRunner.stop();

const importResult = await client.awaitChain({ chain: importChain, timeoutMs: 5000 });
assert.ok(importResult.output.processed > 0 && importResult.output.processed < items.length);
