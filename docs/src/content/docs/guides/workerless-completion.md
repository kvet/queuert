---
title: Completing Without a Worker
description: Complete jobs without a worker for approval workflows.
sidebar:
  order: 12
---

Jobs can be completed without a worker using `completeJobChain`. This enables approval workflows, webhook-triggered completions, and patterns where jobs wait for external events. Deferred start pairs well with this -- schedule a job to auto-reject after a timeout, but allow early completion based on user action.

```ts
const jobTypeRegistry = defineJobTypeRegistry<{
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
const chain = await withTransactionHooks(async (transactionHooks) =>
  client.startJobChain({
    transactionHooks,
    typeName: "await-approval",
    input: { requestId: "123" },
    schedule: { afterMs: 2 * 60 * 60 * 1000 }, // 2 hours
  }),
);

// The worker handles the timeout case (auto-reject) and processes approved requests
const worker = await createInProcessWorker({
  client,
  processorRegistry: createJobTypeProcessorRegistry(client, jobTypeRegistry, {
    "await-approval": {
      attemptHandler: async ({ complete }) => complete(() => ({ rejected: true })),
    },
    "process-request": {
      attemptHandler: async ({ job, complete }) => {
        await doSomethingWith(job.input.requestId);
        return complete(() => ({ processed: true }));
      },
    },
  }),
});

const stop = await worker.start();

// The job can be completed early without a worker (e.g., via API call)
await withTransactionHooks(async (transactionHooks) =>
  client.completeJobChain({
    transactionHooks,
  id: chain.id,
  typeName: "await-approval",
  complete: async ({ job, complete }) => {
    if (job.typeName !== "await-approval") {
      return; // Already past approval stage
    }
    // If approved, continue to process-request; otherwise just reject
    if (userApproved) {
      await complete(job, ({ continueWith }) =>
        continueWith({
          typeName: "process-request",
          input: { requestId: job.input.requestId },
        }),
      );
    } else {
      await complete(job, () => ({ rejected: true }));
    }
  }),
);
```

This pattern lets you interweave external actions with your job chains -- waiting for user input, third-party callbacks, or manual approval steps.

See [examples/showcase-workerless](https://github.com/kvet/queuert/tree/main/examples/showcase-workerless) for a complete working example demonstrating approval workflows and deferred start with early completion. See also [Transaction Hooks](../transaction-hooks/) and [Scheduling](../scheduling/) (deferred start).

## How It Works

The `completeJobChain` method receives the current job and a `complete` function. Inside `complete`, the caller can return an output to finish the chain or call `continueWith` to add the next job -- the same interface as the worker's prepare/complete pattern.

Internally, `complete` uses `FOR UPDATE` to lock the current job, preventing concurrent completion by a worker or another caller. The completed job has `completedBy: null` (no worker identity), distinguishing it from worker-completed jobs.

If a worker is already processing the job when `completeJobChain` runs, the worker detects the external completion via `JobAlreadyCompletedError`. The worker's abort signal fires with reason `"already_completed"`, and the worker abandons its attempt gracefully.
