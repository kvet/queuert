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
   * await-approval --+--> (approved) --> process-request
   *                  |
   *                  +--> (rejected or timed out) --> output { rejected }
   */
  "await-approval": {
    entry: true;
    input: { requestId: string };
    output: { rejected: true; reason: string };
    continueWith: { typeName: "process-request" };
  };
  "process-request": {
    input: { requestId: string };
    output: { processed: true };
  };
}>();
// #endregion

const processedRequests: string[] = [];

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      // #region processors
      "await-approval": {
        attemptHandler: async ({ complete }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, output: { rejected: true, reason: "timeout" } }),
          ),
      },
      "process-request": {
        attemptHandler: async ({ job, complete }) =>
          stateAdapter.withTransaction(async (txCtx) => {
            processedRequests.push(job.input.requestId);
            return complete({ ...txCtx, output: { processed: true } });
          }),
      },
      // #endregion
    },
  }),
});
await workerRunner.start();

// #region create
const requestApproval = async (requestId: string) =>
  stateAdapter.withTransaction(async (txCtx) =>
    client.createChain({
      ...txCtx,
      typeName: "await-approval",
      input: { requestId },
      schedule: { afterMs: 2 * 60 * 60 * 1000 },
    }),
  );
// #endregion

// #region decide
const decideApproval = async (chainId: string, approved: boolean) =>
  stateAdapter.withTransaction(async (txCtx) => {
    const job = await client.getChainTailJob({
      ...txCtx,
      chainId,
      chainTypeName: "await-approval",
      lock: "exclusive",
    });
    if (job?.typeName !== "await-approval" || job.status === "completed") return;

    if (approved) {
      await client.applyJobOutcome({
        ...txCtx,
        job,
        continueWith: { typeName: "process-request", input: { requestId: job.input.requestId } },
      });
      return;
    }
    await client.applyJobOutcome({
      ...txCtx,
      job,
      output: { rejected: true, reason: "manager denied" },
    });
  });
// #endregion

const approvedChain = await requestApproval("request-1");
await decideApproval(approvedChain.id, true);
const approved = await client.awaitChain({ chain: approvedChain, timeoutMs: 5000 });
assert.deepEqual(approved.output, { processed: true });
assert.deepEqual(processedRequests, ["request-1"]);

await decideApproval(approvedChain.id, false);
assert.deepEqual(processedRequests, ["request-1"]);

const rejectedChain = await requestApproval("request-2");
await decideApproval(rejectedChain.id, false);
const rejected = await client.awaitChain({ chain: rejectedChain, timeoutMs: 5000 });
assert.deepEqual(rejected.output, { rejected: true, reason: "manager denied" });

const timedOutChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "await-approval",
    input: { requestId: "request-3" },
    schedule: { afterMs: 50 },
  }),
);
const timedOut = await client.awaitChain({ chain: timedOutChain, timeoutMs: 5000 });
assert.deepEqual(timedOut.output, { rejected: true, reason: "timeout" });
