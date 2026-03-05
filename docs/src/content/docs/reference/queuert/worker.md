---
title: Worker
description: Worker configuration and job processing for the queuert core package.
sidebar:
  order: 3
---

## createInProcessWorker

```typescript
const worker = await createInProcessWorker({
  client: Client,
  workerId?: string,
  concurrency?: number,
  backoffConfig?: BackoffConfig,
  processDefaults?: InProcessWorkerProcessDefaults,
  processors: InProcessWorkerProcessors,
});
```

Returns `Promise<InProcessWorker>`.

- **client** -- the Queuert client to process jobs for
- **workerId** -- unique identifier for this worker (default: random UUID)
- **concurrency** -- maximum number of jobs to process in parallel (default: 1)
- **backoffConfig** -- recovery backoff for the worker loop itself, not individual job retries
- **processDefaults** -- default configuration applied to all job types
- **processors** -- map of job type names to their handler configurations

## InProcessWorker

```typescript
type InProcessWorker = {
  start: () => Promise<() => Promise<void>>;
};
```

Call `start()` to begin processing. It returns a `stop` function for graceful shutdown -- signals the worker to stop spawning new jobs, waits for in-flight jobs to finish, then resolves.

## InProcessWorkerProcessDefaults

Default configuration applied to all job types unless overridden per-processor.

```typescript
type InProcessWorkerProcessDefaults = {
  pollIntervalMs?: number;
  backoffConfig?: BackoffConfig;
  leaseConfig?: LeaseConfig;
  attemptMiddlewares?: JobAttemptMiddleware[];
};
```

- **pollIntervalMs** -- how often to poll for new jobs when no notify adapter is active (default: 60s)
- **backoffConfig** -- backoff for failed job attempts (default: 10s initial, 2x multiplier, 5min max)
- **leaseConfig** -- lease duration and renewal interval for job ownership (default: 60s lease, 30s renewal)
- **attemptMiddlewares** -- middlewares wrapping each job attempt

## InProcessWorkerProcessor

Configuration for processing a single job type. Overrides `processDefaults` for `backoffConfig` and `leaseConfig`.

```typescript
type InProcessWorkerProcessor = {
  attemptHandler: AttemptHandler;
  backoffConfig?: BackoffConfig;
  leaseConfig?: LeaseConfig;
};
```

## AttemptHandler

The core function called for each job attempt.

```typescript
type AttemptHandler = (options: {
  signal: TypedAbortSignal<JobAbortReason>;
  job: RunningJob<JobWithBlockers>;
  prepare: AttemptPrepare;
  complete: AttemptComplete;
}) => Promise<CompletedJob | ContinuationJobs>;
```

**signal** -- a typed `AbortSignal` whose `reason` is a `JobAbortReason`: `"taken_by_another_worker"`, `"error"`, `"not_found"`, or `"already_completed"`. Check `signal.aborted` for early termination.

**job** -- the running job with its typed input and resolved blockers (as `CompletedJobChain[]`).

**prepare** -- controls the processing mode. If never accessed, the worker auto-calls `prepare({ mode: "staged" })`.

```typescript
// Staged mode (default) -- prepare commits first, complete runs in a new transaction
await prepare({ mode: "staged" });

// Atomic mode -- prepare and complete share the same transaction
await prepare({ mode: "atomic" });

// With a callback -- runs within the prepare transaction
const data = await prepare({ mode: "staged" }, async (tx) => {
  return await db.query("SELECT ...", { tx });
});
```

**complete** -- finalizes the job. Either return the output to complete the chain, or call `continueWith` to extend it.

```typescript
// Complete the chain with output
return complete(async () => {
  return { result: "done" }; // Must match the job type's output type
});

// Continue with the next job
return complete(async ({ continueWith }) => {
  return continueWith({
    typeName: "process",
    input: { data: job.input.rawData },
    schedule?: ScheduleOptions,
    blockers?: JobChain[],
  });
});
```

The `complete` callback also receives `transactionHooks` and the transaction context (`tx`), allowing database operations within the completion transaction.

## JobAttemptMiddleware

Wraps each job attempt. Receives the running job and worker ID, plus a `next` function.

```typescript
type JobAttemptMiddleware = <T>(
  context: { job: RunningJob<JobWithBlockers>; workerId: string },
  next: () => Promise<T>,
) => Promise<T>;
```

Example:

```typescript
const loggingMiddleware: JobAttemptMiddleware = async ({ job, workerId }, next) => {
  console.log(`[${workerId}] Processing ${job.typeName} ${job.id}`);
  return next();
};
```

## rescheduleJob

Helper that throws `RescheduleJobError` from within an attempt handler to reschedule the job. See [Utilities](/queuert/reference/queuert/utilities/#reschedulejob) for details.

## mergeJobTypeProcessors

Merges processor maps from multiple slices into a single processors object. See [Utilities](/queuert/reference/queuert/utilities/#mergejobtypeprocessors) for details.

## Handler Types

The following types are exported for use in type annotations and `satisfies` expressions:

- **AttemptComplete** -- the typed `complete` function in `attemptHandler`
- **AttemptCompleteCallback** -- the callback passed to `complete()`
- **AttemptCompleteOptions** -- options received by the complete callback (`continueWith`, `transactionHooks`, tx context)
- **AttemptPrepare** -- the typed `prepare` function in `attemptHandler`
- **AttemptPrepareCallback** -- the callback passed to `prepare(options, callback)`
- **AttemptPrepareOptions** -- `{ mode: "atomic" | "staged" }`

These are generic types parameterized over the state adapter and job type definitions. They're needed when defining processors in separate files with `satisfies InProcessWorkerProcessors`.

## Configuration Types

**BackoffConfig**

```typescript
type BackoffConfig = {
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier?: number; // Default: 2.0
};
```

**LeaseConfig**

```typescript
type LeaseConfig = {
  leaseMs: number;
  renewIntervalMs: number;
};
```

## See Also

- [Client](/queuert/reference/queuert/client/) -- Client API reference
- [Types](/queuert/reference/queuert/types/) -- Job, JobChain, and configuration types
- [Utilities](/queuert/reference/queuert/utilities/) -- Composition helpers and utility functions
- [Errors](/queuert/reference/queuert/errors/) -- Error classes reference
- [In-Process Worker](/queuert/advanced/in-process-worker/) -- Worker lifecycle and concurrency model
- [Job Processing](/queuert/advanced/job-processing/) -- Transactional design and prepare/complete pattern
- [Processing Modes](/queuert/guides/processing-modes/) -- Atomic vs staged processing guide
