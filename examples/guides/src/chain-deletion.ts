import assert from "node:assert/strict";

import {
  BlockerReferenceError,
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

const jobTypes = defineJobTypes<{
  /*
   * fetch-data #1 --+
   *                 +--> generate-report
   * fetch-data #2 --+
   */
  "fetch-data": {
    entry: true;
    input: { source: string };
    output: { data: string };
  };
  "generate-report": {
    entry: true;
    input: { reportId: string };
    output: { summary: string };
    blockers: [...{ typeName: "fetch-data" }[]];
  };
}>();

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "fetch-data": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          await stateAdapter.withTransaction(async (txCtx) =>
            applyJobOutcome({ ...txCtx, output: { data: `data from ${job.input.source}` } }),
          );
        },
      },
      "generate-report": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          const summary = job.blockers.map((blocker) => blocker.output.data).join(", ");
          await stateAdapter.withTransaction(async (txCtx) =>
            applyJobOutcome({ ...txCtx, output: { summary } }),
          );
        },
      },
    },
  }),
});
await workerRunner.start();

const chain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "fetch-data", input: { source: "/users" } }),
);
await client.awaitChain({ chain, timeoutMs: 5000 });

// #region delete
const deletedChains = await stateAdapter.withTransaction(async (txCtx) =>
  client.deleteChains({ ...txCtx, ids: [chain.id] }),
);
// #endregion

assert.deepEqual(
  deletedChains.map((deletedChain) => deletedChain.id),
  [chain.id],
);

// #region delete-single
const deletedAgain = await stateAdapter.withTransaction(async (txCtx) =>
  client.deleteChain({ ...txCtx, id: chain.id }),
);
// #endregion

assert.equal(deletedAgain, undefined);

const { fetchChains, reportChain } = await stateAdapter.withTransaction(async (txCtx) => {
  const fetchChains = await client.createChains({
    ...txCtx,
    items: [
      { typeName: "fetch-data", input: { source: "/orders" } },
      { typeName: "fetch-data", input: { source: "/products" } },
    ],
  });
  const reportChain = await client.createChain({
    ...txCtx,
    typeName: "generate-report",
    input: { reportId: "report-1" },
    blockers: fetchChains,
  });
  return { fetchChains, reportChain };
});
await client.awaitChain({ chain: reportChain, timeoutMs: 5000 });

// #region blocker-safety
const deleteBlockerOnly = stateAdapter.withTransaction(async (txCtx) =>
  client.deleteChains({ ...txCtx, ids: [fetchChains[0].id] }),
);
// #endregion

await assert.rejects(deleteBlockerOnly, BlockerReferenceError);

// #region co-delete
const deletedWithBlockers = await stateAdapter.withTransaction(async (txCtx) => {
  const blockerChains = await client.getJobBlockers({ ...txCtx, jobId: reportChain.id });
  return client.deleteChains({
    ...txCtx,
    ids: [reportChain.id, ...blockerChains.map((blocker) => blocker.id)],
  });
});
// #endregion

assert.equal(deletedWithBlockers.length, 3);
