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
  jobTypeProcessorDefaults?: JobTypeProcessorDefaults,
  jobTypeProcessorRegistry: JobTypeProcessorRegistry,
});
```

Returns `Promise<InProcessWorker>`.

- **client** — the Queuert client to process jobs for
- **workerId** — unique identifier for this worker (default: random UUID)
- **concurrency** — maximum number of jobs to process in parallel (default: 1)
- **backoffConfig** — recovery backoff for the worker loop itself, not individual job retries
- **jobTypeProcessorDefaults** — default configuration applied to all job types
- **jobTypeProcessorRegistry** — a `JobTypeProcessorRegistry` from `createJobTypeProcessorRegistry` or `mergeJobTypeProcessorRegistries`. The registry's definitions must be a subset of the client's registry definitions.

## InProcessWorker

```typescript
type InProcessWorker = {
  start: () => Promise<() => Promise<void>>;
};
```

Call `start()` to begin processing. It returns a `stop` function for graceful shutdown — signals the worker to stop spawning new jobs, waits for in-flight jobs to finish, then resolves.

## JobTypeProcessorDefaults

Default configuration applied to all job types unless overridden per-processor.

```typescript
type JobTypeProcessorDefaults = {
  pollIntervalMs?: number;
  backoffConfig?: BackoffConfig;
  leaseConfig?: LeaseConfig;
  attemptMiddlewares?: JobAttemptMiddleware[];
};
```

- **pollIntervalMs** — how often to poll for new jobs when no notify adapter is active (default: 60s)
- **backoffConfig** — backoff for failed job attempts (default: 10s initial, 2x multiplier, 5min max)
- **leaseConfig** — lease duration and renewal interval for job ownership (default: 60s lease, 30s renewal)
- **attemptMiddlewares** — middlewares wrapping each job attempt

## InProcessWorkerProcessor

Configuration for processing a single job type. Overrides `jobTypeProcessorDefaults` for `backoffConfig` and `leaseConfig`.

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
  job: ResolvedJobWithBlockers & { status: "running" };
  prepare: AttemptPrepare;
  complete: AttemptComplete;
}) => Promise<(ResolvedJobWithBlockers & { status: "completed" }) | ContinuationJobs>;
```

**signal** — a typed `AbortSignal` whose `reason` is a `JobAbortReason`: `"taken_by_another_worker"`, `"error"`, `"not_found"`, or `"already_completed"`. Check `signal.aborted` for early termination.

**job** — the running job with its typed input and resolved blockers (as `CompletedJobChain[]`).

**prepare** — controls the processing mode. If never accessed, the worker infers the mode from how `complete` is called: synchronous `return complete(...)` → atomic; any `await` before `return complete(...)` → staged. See [Job Processing Modes](/queuert/guides/processing-modes/).

```typescript
// Atomic mode — prepare and complete share the same transaction
await prepare({ mode: "atomic" });

// Staged mode — prepare commits first, complete runs in a new transaction
await prepare({ mode: "staged" });

// With a callback — runs within the prepare transaction
const data = await prepare({ mode: "staged" }, async (tx) => {
  return await db.query("SELECT ...", { tx });
});
```

**complete** — finalizes the job. Either return the output to complete the chain, or call `continueWith` to extend it.

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
  context: { job: ResolvedJobWithBlockers & { status: "running" }; workerId: string },
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

## mergeJobTypeProcessorRegistries

Merges processor registries from multiple slices into a single registry. See [Utilities](/queuert/reference/queuert/utilities/#mergejobtypeprocessorregistries) for details.

## createJobTypeProcessorRegistry

Defines a processor registry for a job type slice with full type inference. See [Utilities](/queuert/reference/queuert/utilities/#createjobtypeprocessorregistry) for details.

## Handler Types

The following types are exported for use in type annotations:

- **AttemptComplete** — the typed `complete` function in `attemptHandler`
- **AttemptCompleteCallback** — the callback passed to `complete()`
- **AttemptCompleteOptions** — options received by the complete callback (`continueWith`, `transactionHooks`, tx context)
- **AttemptPrepare** — the typed `prepare` function in `attemptHandler`
- **AttemptPrepareCallback** — the callback passed to `prepare(options, callback)`
- **AttemptPrepareOptions** — `{ mode: "atomic" | "staged" }`

These are generic types parameterized over the state adapter and job type definitions.

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

- [Client](/queuert/reference/queuert/client/) — Client API reference
- [Types](/queuert/reference/queuert/types/) — Job, JobChain, and configuration types
- [Utilities](/queuert/reference/queuert/utilities/) — Composition helpers and utility functions
- [Errors](/queuert/reference/queuert/errors/) — Error classes reference
- [In-Process Worker](/queuert/advanced/in-process-worker/) — Worker lifecycle and concurrency model
- [Job Processing](/queuert/advanced/job-processing/) — Transactional design and prepare/complete pattern
- [Processing Modes](/queuert/guides/processing-modes/) — Atomic vs staged processing guide
