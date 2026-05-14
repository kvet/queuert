---
title: Worker
description: Worker configuration, job processing, and worker-related types for the queuert core package.
sidebar:
  order: 3
---

## createInProcessWorker

```typescript
const worker = await createInProcessWorker({
  client: Client,
  workerName?: string,
  concurrency?: number,
  pollIntervalMs?: number,
  recoveryBackoffConfig?: BackoffConfig,
  defaults?: InProcessWorkerDefaults,
  processors: Processors,
});
```

Returns `Promise<InProcessWorker>`.

- **client** — the Queuert client to process jobs for
- **workerName** — optional human-readable label included in the worker id. Must match `/^[A-Za-z0-9._-]+$/` when provided (letters, digits, `.`, `_`, `-`). The id is always suffixed with a random UUID (`${workerName}-${uuid}` or just `${uuid}` when omitted), so two replicas with the same name still get distinct ids and cannot collide on lease ownership
- **concurrency** — maximum number of jobs to process in parallel (default: 1)
- **pollIntervalMs** — how often the worker polls for new jobs when no notify adapter wakes it (default: 60s)
- **recoveryBackoffConfig** — recovery backoff for the worker loop itself (not job retries)
- **defaults** — fallback `backoffConfig` / `leaseConfig` for processors that don't set their own. Resolution order is: processor → registry → worker `defaults` → library default
- **processors** — a single `Processors` from `createProcessors`, or an array of slices to merge. See [Slices guide](/queuert/guides/slices/). Middleware is declared on the registry; see [Middleware guide](/queuert/guides/middleware/)

### InProcessWorkerDefaults

```typescript
type InProcessWorkerDefaults = {
  backoffConfig?: BackoffConfig;
  leaseConfig?: LeaseConfig;
};
```

Worker-level fallbacks applied to every processor that doesn't declare its own `backoffConfig` / `leaseConfig` (whether directly on the processor or via the registry default in `createProcessors`).

## InProcessWorker — Methods

### start

```typescript
const stop = await worker.start();
await stop();
```

Begins polling for and processing jobs. Returns a `stop` function for graceful shutdown — `stop()` signals the worker to stop spawning new jobs, waits for in-flight jobs to finish, then resolves.

## Types

### InProcessWorker

```typescript
type InProcessWorker = {
  start: () => Promise<() => Promise<void>>;
};
```

The handle returned by `createInProcessWorker`.

### InProcessWorkerProcessor

```typescript
type InProcessWorkerProcessor = {
  attemptHandler: AttemptHandler;
  backoffConfig?: BackoffConfig;
  leaseConfig?: LeaseConfig;
};
```

Configuration for processing a single job type. `backoffConfig` and `leaseConfig` override the registry-level defaults — resolution order is: processor → registry → library default.

### AttemptHandler

```typescript
type AttemptHandler = (options: {
  signal: TypedAbortSignal<JobAbortReason>;
  job: ResolvedJobWithBlockers & { status: "running" };
  prepare: AttemptPrepare;
  complete: AttemptComplete;
}) => Promise<(ResolvedJobWithBlockers & { status: "completed" }) | ContinuationJobs>;
```

The core function called for each job attempt.

- **signal** — typed `AbortSignal` whose `reason` is a `JobAbortReason`
- **job** — the running job with its typed input and resolved blockers
- **prepare** — controls the processing mode (atomic or staged). See the [Processing Modes guide](/queuert/guides/processing-modes/)
- **complete** — finalizes the job. Return the output to complete the chain, or call `continueWith` to extend it

### AttemptComplete

The typed `complete` function provided to the attempt handler. Call it to finalize the job — either return the output to complete the chain, or call `continueWith` to extend it.

### AttemptCompleteCallback

The callback passed to `complete()`. Receives `AttemptCompleteOptions` and returns the result.

### AttemptCompleteOptions

Options received by the complete callback: `continueWith` (to extend the chain), `transactionHooks`, and the transaction context.

### AttemptPrepare

The typed `prepare` function provided to the attempt handler. Controls the processing mode and optionally runs a callback within the prepare transaction.

### AttemptPrepareCallback

The callback passed to `prepare(options, callback)`. Receives the transaction context.

### AttemptPrepareOptions

```typescript
type AttemptPrepareOptions = { mode: "atomic" | "staged" };
```

`"atomic"` runs prepare and complete in the same transaction. `"staged"` commits prepare first, then runs complete in a new transaction with lease renewal.

### AttemptMiddleware

```typescript
type AttemptMiddleware<
  TStateAdapter,
  THandlerCtx extends Record<string, unknown> = {},
  TPrepareCtx extends Record<string, unknown> = {},
  TCompleteCtx extends Record<string, unknown> = {},
> = {
  wrapHandler?: <T>(opts: {
    job: ResolvedJobWithBlockers & { status: "running" };
    workerId: string;
    next: (ctx: THandlerCtx) => Promise<T>;
  }) => Promise<T>;
  wrapPrepare?: <T>(opts: {
    job: ResolvedJobWithBlockers & { status: "running" };
    next: (ctx: TPrepareCtx) => Promise<T>;
    // plus state-adapter-specific transaction context fields
  }) => Promise<T>;
  wrapComplete?: <T>(opts: {
    job: ResolvedJobWithBlockers & { status: "running" };
    transactionHooks: TransactionHooks;
    next: (ctx: TCompleteCtx) => Promise<T>;
    // plus state-adapter-specific transaction context fields
  }) => Promise<T>;
};
```

Wraps job processing with cross-cutting logic. Each hook is optional — implement only the phases you need. The `next(ctx)` callback injects typed context that becomes available to the inner handler.

- **wrapHandler** — wraps the entire attempt handler. Injected ctx merges into `attemptHandler`'s options
- **wrapPrepare** — wraps the user-supplied `prepare` callback. Injected ctx merges into the callback's options alongside the transaction context
- **wrapComplete** — wraps the user-supplied `complete` callback. Injected ctx merges into the callback's options alongside `continueWith`, `transactionHooks`, and the transaction context

Multiple middleware compose as an onion — the first middleware's "before" runs outermost. See the [Middleware guide](/queuert/guides/middleware/) for usage patterns.

### BackoffConfig

```typescript
type BackoffConfig = {
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier?: number; // Default: 2
};
```

Exponential backoff parameters.

- **initialDelayMs** — delay after the first failure
- **maxDelayMs** — caps the delay
- **multiplier** — controls exponential growth

### RetryConfig

```typescript
type RetryConfig = BackoffConfig & {
  maxAttempts?: number;
};
```

Extends `BackoffConfig` with **maxAttempts**, the maximum number of retry attempts before the operation is abandoned.

### LeaseConfig

```typescript
type LeaseConfig = {
  leaseMs: number;
  renewIntervalMs: number;
};
```

Controls job lease duration and renewal.

- **leaseMs** — total lease time granted to a worker
- **renewIntervalMs** — how often the worker renews the lease before it expires

### TypedAbortSignal

```typescript
type TypedAbortSignal<T> = Omit<AbortSignal, "reason"> & {
  readonly reason: T | undefined;
};
```

An `AbortSignal` with a typed **reason**. Used in worker handlers to communicate why a job was aborted.

### JobAbortReason

```typescript
type JobAbortReason = "taken_by_another_worker" | "error" | "not_found" | "already_completed";
```

The possible abort reasons passed through `TypedAbortSignal` in worker job handlers.

- **taken_by_another_worker** — the lease was lost to another worker
- **error** — an internal failure occurred
- **not_found** — the job no longer exists
- **already_completed** — the job was already completed

## See Also

- [Client](/queuert/reference/queuert/client/) — Client API reference
- [Utilities](/queuert/reference/queuert/utilities/) — `createProcessors`, `defineJobTypes`, `createJobTypes`
- [Entities](/queuert/reference/queuert/entities/) — `Job`, `Chain`, and resolved variants
- [Errors](/queuert/reference/queuert/errors/) — error reference
- [In-Process Worker](/queuert/advanced/in-process-worker/) — Worker lifecycle and concurrency model
- [Job Processing](/queuert/advanced/job-processing/) — Transactional design and prepare/complete pattern
- [Processing Modes](/queuert/guides/processing-modes/) — Atomic vs staged processing guide
- [Middleware](/queuert/guides/middleware/) — Writing and composing attempt middleware
