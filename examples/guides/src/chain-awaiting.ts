import assert from "node:assert/strict";

import {
  WaitChainTimeoutError,
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

// #region types
const jobTypes = defineJobTypes<{
  /*
   * fetch-price --> apply-discount
   */
  "fetch-price": {
    entry: true;
    input: { productId: string };
    continueWith: { typeName: "apply-discount" };
  };
  "apply-discount": {
    input: { productId: string; basePrice: number };
    output: { productId: string; finalPrice: number };
  };
}>();
// #endregion

const basePrices = new Map([
  ["widget", 30],
  ["gadget", 50],
  ["gizmo", 20],
]);

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "fetch-price": {
        attemptHandler: async ({ job, applyOutcome }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            applyOutcome({
              ...txCtx,
              continueWith: {
                typeName: "apply-discount",
                input: {
                  productId: job.input.productId,
                  basePrice: basePrices.get(job.input.productId)!,
                },
              },
            }),
          ),
      },
      "apply-discount": {
        attemptHandler: async ({ job, applyOutcome }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            applyOutcome({
              ...txCtx,
              output: { productId: job.input.productId, finalPrice: job.input.basePrice * 0.9 },
            }),
          ),
      },
    },
  }),
});
await workerRunner.start();

// #region await-one
const priceChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "fetch-price", input: { productId: "widget" } }),
);

const completedChain = await client.awaitChain({
  chain: priceChain,
  timeoutMs: 30_000,
  pollIntervalMs: 5_000,
});
// #endregion

assert.deepEqual(completedChain.output, { productId: "widget", finalPrice: 27 });

// #region await-many
const priceChains = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChains({
    ...txCtx,
    items: [
      { typeName: "fetch-price", input: { productId: "gadget" } },
      { typeName: "fetch-price", input: { productId: "gizmo" } },
    ],
  }),
);

const completedChains = await client.awaitChains({ chains: priceChains, timeoutMs: 30_000 });
// #endregion

assert.deepEqual(
  completedChains.map((chain) => chain.output.finalPrice),
  [45, 18],
);

const laterChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "fetch-price",
    input: { productId: "widget" },
    schedule: { afterMs: 60_000 },
  }),
);

await assert.rejects(
  client.awaitChain({ chain: laterChain, timeoutMs: 100 }),
  WaitChainTimeoutError,
);

// #region await-abort
const request = new AbortController();
setTimeout(() => {
  request.abort();
}, 100);

const laterPrice = await client
  .awaitChain({ chain: laterChain, timeoutMs: 30_000, signal: request.signal })
  .then(
    (chain) => chain.output.finalPrice,
    (error: unknown) => {
      if (error instanceof WaitChainTimeoutError) return undefined;
      throw error;
    },
  );
// #endregion

assert.equal(laterPrice, undefined);
