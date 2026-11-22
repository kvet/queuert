import assert from "node:assert/strict";

import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

const jobTypes = defineJobTypes<{
  /*
   * reserve-stock --> process-order --> ship-order
   */
  "reserve-stock": {
    entry: true;
    input: { orderId: string };
    output: { reserved: true };
  };
  "process-order": {
    entry: true;
    input: { orderId: string };
    blockers: [{ typeName: "reserve-stock" }];
    continueWith: { typeName: "ship-order" };
  };
  "ship-order": {
    input: { orderId: string };
    output: { trackingNumber: string };
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
      "reserve-stock": {
        attemptHandler: async ({ applyOutcome }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            applyOutcome({ ...txCtx, output: { reserved: true } }),
          ),
      },
      "process-order": {
        attemptHandler: async ({ job, applyOutcome }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            applyOutcome({
              ...txCtx,
              continueWith: { typeName: "ship-order", input: { orderId: job.input.orderId } },
            }),
          ),
      },
      "ship-order": {
        attemptHandler: async ({ job, applyOutcome }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            applyOutcome({ ...txCtx, output: { trackingNumber: `track-${job.input.orderId}` } }),
          ),
      },
    },
  }),
});
await workerRunner.start();

const createOrder = async (orderId: string) =>
  stateAdapter.withTransaction(async (txCtx) => {
    const stockChain = await client.createChain({
      ...txCtx,
      typeName: "reserve-stock",
      input: { orderId },
    });
    const orderChain = await client.createChain({
      ...txCtx,
      typeName: "process-order",
      input: { orderId },
      blockers: [stockChain],
    });
    return { stockChain, orderChain };
  });
const { stockChain, orderChain } = await createOrder("order-1");
const { orderChain: secondOrderChain } = await createOrder("order-2");
await client.awaitChain({ chain: orderChain, timeoutMs: 5000 });
await client.awaitChain({ chain: secondOrderChain, timeoutMs: 5000 });

// #region lookups
const chain = await client.getChain({ id: orderChain.id, typeName: "process-order" });
const job = await client.getJob({ id: orderChain.id });

const chains = await client.getChains({ ids: [orderChain.id, stockChain.id, "missing-id"] });
const jobs = await client.getJobs({ ids: [orderChain.id, stockChain.id] });
// #endregion

assert.equal(chain?.status, "completed");
assert.equal(chain.status === "completed" && chain.output.trackingNumber, "track-order-1");
assert.equal(job?.typeName, "process-order");
assert.equal(chains[2], undefined);
assert.equal(jobs.length, 2);

// #region in-transaction
const chainInTransaction = await stateAdapter.withTransaction(async (txCtx) =>
  client.getChain({ ...txCtx, id: orderChain.id }),
);
// #endregion

assert.equal(chainInTransaction?.id, orderChain.id);

// #region type-counts
const chainTypeNames = await client.getChainTypeNames();
const jobTypeNames = await client.getJobTypeNames();

const [orderChainCounts] = await client.countChainsByTypeName({ typeNames: ["process-order"] });
const [shipJobCounts] = await client.countJobsByTypeName({ typeNames: ["ship-order"] });
// #endregion

assert.deepEqual([...chainTypeNames].sort(), ["process-order", "reserve-stock"]);
assert.ok(jobTypeNames.includes("ship-order"));
assert.equal(orderChainCounts.completed.count, 2);
assert.equal(shipJobCounts.completed.count, 2);

// #region lists
const firstPage = await client.listChains({
  typeName: "process-order",
  status: "completed",
  limit: 1,
});
const secondPage = await client.listChains({
  typeName: "process-order",
  status: "completed",
  cursor: firstPage.nextCursor ?? undefined,
  limit: 1,
});

const shipJobs = await client.listJobs({
  typeName: "ship-order",
  status: "completed",
  orderBy: "createdAt",
});
// #endregion

assert.notEqual(firstPage.items[0].id, secondPage.items[0].id);
assert.equal(shipJobs.items.length, 2);

// #region chain-jobs
const chainJobs = await client.listChainJobs({
  chainId: orderChain.id,
  chainTypeName: "process-order",
});

const tailJob = await client.getChainTailJob({ chainId: orderChain.id });
const tailJobs = await client.getChainTailJobs({ chainIds: [orderChain.id, stockChain.id] });
// #endregion

assert.deepEqual(
  chainJobs.items.map((chainJob) => chainJob.typeName),
  ["process-order", "ship-order"],
);
assert.equal(tailJob?.typeName, "ship-order");
assert.equal(tailJobs[1]?.id, stockChain.id);

// #region locked-reads
const lockedTail = await stateAdapter.withTransaction(async (txCtx) => {
  const tail = await client.getChainTailJob({
    ...txCtx,
    chainId: secondOrderChain.id,
    chainTypeName: "process-order",
    lock: "exclusive",
  });
  if (tail?.status === "pending") {
    await client.applyJobOutcome({ ...txCtx, job: tail, reschedule: { afterMs: 60 * 60 * 1000 } });
  }
  return tail;
});
// #endregion

assert.equal(lockedTail?.typeName, "ship-order");
assert.equal(lockedTail.status, "completed");

// #region blockers
const blockers = await client.getJobBlockers({ jobId: orderChain.id, typeName: "process-order" });
const blockedJobs = await client.listBlockedJobs({ chainId: stockChain.id });
// #endregion

assert.equal(blockers[0].status === "completed" && blockers[0].output.reserved, true);
assert.equal(blockedJobs.items[0].id, orderChain.id);

// #region workers
const workerPage = await client.listWorkers({ limit: 20 });
const workerId = workerPage.items[0].id;

const worker = await client.getWorker({ id: workerId });
const { live, expired } = await client.countWorkers();
const [shipWorkers] = await client.countWorkersByTypeName({ typeNames: ["ship-order"] });
const [runningJobCount] = await client.countRunningJobsByWorkerId({ workerIds: [workerId] });
const runningJobs = await client.listWorkerJobs({ workerId });
// #endregion

assert.equal(worker?.id, workerId);
assert.deepEqual({ live, expired }, { live: 1, expired: 0 });
assert.equal(shipWorkers.live, 1);
assert.equal(runningJobCount, 0);
assert.equal(runningJobs.items.length, 0);
