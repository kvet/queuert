import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

// #region job-types
const jobTypes = defineJobTypes<{
  /*
   * email.transactional --> transactional worker (concurrency 3)
   */
  "email.transactional": {
    entry: true;
    input: { to: string; subject: string };
    output: { sentAt: number };
  };
  /*
   * email.marketing --> marketing worker (concurrency 1)
   */
  "email.marketing": {
    entry: true;
    input: { to: string; subject: string };
    output: { sentAt: number };
  };
  // #hide

  /*
   * alert.dispatch (transactional worker) --> alert.archive (marketing worker)
   */
  "alert.dispatch": {
    entry: true;
    input: { alertId: string };
    continueWith: { typeName: "alert.archive" };
  };
  "alert.archive": {
    input: { alertId: string };
    output: { archivedAt: number };
  };
  // #endhide
}>();
// #endregion

const completions: { worker: "transactional" | "marketing"; label: string }[] = [];
const simulateWork = async (
  worker: "transactional" | "marketing",
  label: string,
  durationMs: number,
) => {
  await setTimeout(durationMs);
  completions.push({ worker, label });
};

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });

// #region workers
const client = createClient({ stateAdapter, jobTypes });

await using transactionalWorkerRunner = createWorkerRunner({
  client,
  concurrency: 3,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "email.transactional": {
        attemptHandler: async ({ job, complete }) => {
          await simulateWork("transactional", job.input.to, 20);
          return stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, output: { sentAt: Date.now() } }),
          );
        },
      },
      // #hide
      // #region handoff
      "alert.dispatch": {
        attemptHandler: async ({ job, complete }) => {
          await simulateWork("transactional", job.input.alertId, 20);
          return stateAdapter.withTransaction(async (txCtx) =>
            complete({
              ...txCtx,
              continueWith: { typeName: "alert.archive", input: { alertId: job.input.alertId } },
            }),
          );
        },
      },
      // #endregion
      // #endhide
    },
  }),
});

await using marketingWorkerRunner = createWorkerRunner({
  client,
  concurrency: 1,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "email.marketing": {
        attemptHandler: async ({ job, complete }) => {
          await simulateWork("marketing", job.input.to, 200);
          return stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, output: { sentAt: Date.now() } }),
          );
        },
      },
      // #hide
      "alert.archive": {
        attemptHandler: async ({ job, complete }) => {
          await simulateWork("marketing", job.input.alertId, 200);
          return stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, output: { archivedAt: Date.now() } }),
          );
        },
      },
      // #endhide
    },
  }),
});
// #endregion
await transactionalWorkerRunner.start();
await marketingWorkerRunner.start();

const marketingChains = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChains({
    ...txCtx,
    items: Array.from({ length: 5 }, (_, index) => ({
      typeName: "email.marketing" as const,
      input: { to: `reader-${index}@example.com`, subject: "Weekly digest" },
    })),
  }),
);
const transactionalChains = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChains({
    ...txCtx,
    items: ["alice", "bob", "carol"].map((name) => ({
      typeName: "email.transactional" as const,
      input: { to: `${name}@example.com`, subject: "Password reset" },
    })),
  }),
);
await client.awaitChains({ chains: [...marketingChains, ...transactionalChains], timeoutMs: 5000 });

const workers = completions.map((completion) => completion.worker);
const marketingPositions = workers.flatMap((worker, index) =>
  worker === "marketing" ? [index] : [],
);
assert.ok(workers.lastIndexOf("transactional") < marketingPositions[2]);

completions.length = 0;
const alertChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "alert.dispatch", input: { alertId: "alert-42" } }),
);
const alert = await client.awaitChain({ chain: alertChain, timeoutMs: 5000 });

assert.equal(typeof alert.output.archivedAt, "number");
assert.deepEqual(completions, [
  { worker: "transactional", label: "alert-42" },
  { worker: "marketing", label: "alert-42" },
]);
