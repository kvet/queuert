---
title: Completing Without a Worker
description: Complete jobs without a worker for approval workflows.
sidebar:
  order: 12
---

Jobs can be completed without a worker using `completeChain`. This enables approval workflows, webhook-triggered completions, and patterns where jobs wait for external events. Deferred start pairs well with this -- schedule a job to auto-reject after a timeout, but allow early completion based on user action.

```ts
const jobTypes = defineJobTypes<{
  "await-approval": {
    entry: true;
    input: { requestId: string };
    output: { rejected: true };
    continueWith: { typeName: "process-request" };
  };
  "process-request": {
    input: { requestId: string };
    output: { processed: true };
  };
}>();

// Start a job that auto-rejects in 2 hours if not handled
const chain = await withTxHooks(async (txHooks) =>
  stateProvider.withTransaction(async (txCtx) =>
    client.createChain({
      ...txCtx,
      txHooks,
      typeName: "await-approval",
      input: { requestId: "123" },
      schedule: { afterMs: 2 * 60 * 60 * 1000 }, // 2 hours
    }),
  ),
);

// The worker handles the timeout case (auto-reject) and processes approved requests
const workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "await-approval": {
        attemptHandler: async ({ complete }) =>
          withTxHooks(async (txHooks) =>
            stateProvider.withTransaction(async (txCtx) =>
              complete({ ...txCtx, txHooks, output: { rejected: true } }),
            ),
          ),
      },
      "process-request": {
        attemptHandler: async ({ job, complete }) => {
          await doSomethingWith(job.input.requestId);
          return withTxHooks(async (txHooks) =>
            stateProvider.withTransaction(async (txCtx) =>
              complete({ ...txCtx, txHooks, output: { processed: true } }),
            ),
          );
        },
      },
    },
  }),
});

const stop = await workerRunner.start();

// The job can be completed early without a worker (e.g., via API call)
await withTxHooks(async (txHooks) =>
  stateProvider.withTransaction(async (txCtx) =>
    client.completeChain({
      ...txCtx,
      txHooks,
      id: chain.id,
      typeName: "await-approval",
      handler: async ({ job, completeJob }) => {
        if (job.typeName !== "await-approval") {
          return; // Already past approval stage
        }
        // If approved, continue to process-request; otherwise just reject
        if (userApproved) {
          await completeJob(job, async ({ complete }) =>
            complete({
              continueWith: {
                typeName: "process-request",
                input: { requestId: job.input.requestId },
              },
            }),
          );
        } else {
          await completeJob(job, async ({ complete }) => complete({ output: { rejected: true } }));
        }
      },
    }),
  ),
);
```

This pattern lets you interweave external actions with your chains -- waiting for user input, third-party callbacks, or manual approval steps.

See [examples/showcase-workerless](https://github.com/kvet/queuert/tree/main/examples/showcase-workerless) for a complete working example demonstrating approval workflows and deferred start with early completion. See also [Tx Hooks](../tx-hooks/) and [Scheduling](../scheduling/) (deferred start).

## How It Works

The `completeChain` method calls your `handler` with the current job and a `completeJob` function. Pass the job to `completeJob`, then call `complete` with the outcome you want: `{ output: ... }` finishes the chain, `{ continueWith: {...} }` adds the next job.

Your handler can also decline: just return without calling `completeJob`. The chain stays untouched. Use this when the chain has already moved past the stage you meant to complete.

Internally, `completeChain` locks the current job at the state adapter level, preventing concurrent completion by a worker or another caller. The completed job has `completedBy: null` (no worker identity), distinguishing it from worker-completed jobs.

If a worker is already processing the job when `completeChain` runs, `completeChain` takes the job over. The handler's abort signal fires when the notify adapter delivers the attempt-lost notification, and its `complete`, when it runs, writes nothing and throws `JobAlreadyCompletedError`, so the handler's transaction rolls back. If the handler is inside a [fenced](/queuert/how-it-works/job-processing/#fence) transaction, `completeChain` waits for it to end.
