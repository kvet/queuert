# Job Processing Model

## Overview

This document describes how Queuert processes jobs, including the transactional design, prepare/complete pattern, timeout philosophy, and workerless completion.

## Transactional Design

Queuert's core design principle is that **jobs are created inside the same database transaction as your application state changes**. This follows the transactional outbox pattern:

```typescript
await db.transaction(async (tx) => {
  // Application state change
  const image = await tx.images.create({ ... });

  // Job creation in the same transaction
  // The transaction context (here `tx`) is passed directly - property name matches your StateProvider
  await queuert.startJobChain({
    tx,
    typeName: "process-image",
    input: { imageId: image.id },
  });
});
```

### Why This Matters

1. **Atomicity**: If the transaction rolls back, the job is never created. No orphaned jobs.
2. **Consistency**: The job always references valid application state.
3. **No dual-write problem**: You don't need to coordinate between your database and a separate job queue.

### Extending to Job Processing

The same transactional principle extends to job processing through the prepare/complete pattern:

- **Prepare phase**: Read application state within a transaction
- **Processing phase**: Perform side-effects (API calls, file operations) outside the transaction
- **Complete phase**: Write results back within a transaction

This ensures that job outputs and continuations are also created atomically with any state changes they produce.

## Prepare/Complete Pattern

Job process functions split processing into distinct phases to support both atomic (single-transaction) and staged (long-running) operations.

### Process Function Signature

```typescript
process: async ({ signal, job, prepare, complete }) => { ... }
```

- `signal`: AbortSignal that fires when job is taken by another worker, job is not found, or job is completed externally (reason: `"taken_by_another_worker"`, `"error"`, `"not_found"`, or `"already_completed"`)
- `job`: The job being processed with typed input. Access resolved blockers via `job.blockers` (typed by job type definition).
- `prepare`: Function to configure prepare phase (optional - staged mode runs automatically if not called)
- `complete`: Function to complete the job (always available from process options)

### Prepare Phase

```typescript
const result = await prepare({ mode }, callback?)
```

- `mode`: `"atomic"` runs entirely in one transaction; `"staged"` allows long-running work between prepare and complete with lease renewal
- Optional callback receives the transaction context you defined in your `StateProvider` (e.g., `{ sql }` for postgres.js, `{ db }` for Drizzle, etc.)
- Returns callback result directly (or void if no callback)

### Processing Phase (Staged Mode Only)

Between prepare and complete, perform long-running work. The worker automatically renews the job lease. Implement idempotently as this phase may retry if the worker crashes.

### Complete Phase

```typescript
return complete(({ sql, continueWith }) => { ... })
```

- Callback receives your transaction context (e.g., `sql`) plus `continueWith`
- Commits state changes in a transaction
- `continueWith` continues to the next job in the chain
- Return value becomes the job output

### Auto-Setup

If you don't call `prepare`, auto-setup runs based on when you call `complete`:

- If `prepare` is not accessed and `complete` is not called synchronously, auto-setup runs in staged mode
- If `complete` is called before `prepare`, auto-setup runs in atomic mode (no lease renewal between prepare and complete)
- Accessing `prepare` after auto-setup throws: "Prepare cannot be accessed after auto-setup"

This means simple process functions default to staged mode:

```typescript
process: async ({ job, complete }) => {
  // Transaction already closed, lease renewal running
  return complete(() => output);
};
```

## Timeouts

Queuert does not provide built-in soft timeout functionality. This is intentional:

1. **Userland solution is trivial**: Combine `AbortSignal.timeout()` with the existing `signal` parameter using `AbortSignal.any()`
2. **Lease mechanism is the hard timeout**: If a job doesn't complete within `leaseMs`, the reaper reclaims it and another worker retries

### Cooperative Timeouts

Users implement cooperative timeouts in their process functions:

```typescript
process: async ({ signal, job, complete }) => {
  const timeout = AbortSignal.timeout(30_000);
  const combined = AbortSignal.any([signal, timeout]);

  // Use combined signal for cancellable operations
  await fetch(url, { signal: combined });

  return complete(() => output);
};
```

### Hard Timeouts

For hard timeouts (forceful termination), the lease mechanism already handles this:

- Configure `leaseMs` appropriately for the job type
- If the job doesn't complete or renew its lease in time, the reaper reclaims it
- Another worker can then retry the job

## Workerless Completion

Jobs can be completed without a worker using `completeJobChain` (sets `completedBy: null`). This enables:

- Approval workflows
- Webhook-triggered completions
- Patterns where jobs wait for external events

### Usage

```typescript
await queuert.completeJobChain({
  client,
  typeName: "awaiting-approval",
  id: jobChain.id,
  complete: async ({ job, complete }) => {
    // Inspect current job state
    if (job.status === "blocked") {
      // Can complete blockers first if needed
    }

    // Complete with output (completes the job)
    await complete(job, async () => ({ approved: true }));

    // Or continue to next job in chain
    await complete(job, async ({ continueWith }) =>
      continueWith({ typeName: "process-approved", input: { ... } })
    );
  },
});
```

### Key Behaviors

- Must be called within a transaction (uses `FOR UPDATE` lock on current job)
- `complete` callback receives current job, can call inner `complete` multiple times for multi-step chains
- Partial completion supported: complete one job and leave the next pending
- Can complete blocked jobs (user's responsibility to handle/compensate blockers)
- Running workers detect completion by others via `JobAlreadyCompletedError` and abort signal with reason `"already_completed"`

### Pattern: Deferred Start with Early Completion

Deferred start pairs well with workerless completion - schedule a job to auto-reject after a timeout, but allow early completion based on user action:

```typescript
// Start a job that auto-rejects in 2 hours if not handled
const chain = await queuert.startJobChain({
  typeName: 'await-approval',
  input: { requestId: '123' },
  schedule: { afterMs: 2 * 60 * 60 * 1000 }, // 2 hours
});

// Worker handles timeout case (auto-reject)
const worker = await createQueuertInProcessWorker({
  stateAdapter,
  jobTypeRegistry: jobTypes,
  log: createConsoleLog(),
  jobTypeProcessors: {
    'await-approval': {
      process: async ({ complete }) => complete(() => ({ rejected: true })),
    },
  },
});

await worker.start();

// Job can be completed early without a worker
await queuert.completeJobChain({
  id: chain.id,
  typeName: 'await-approval',
  complete: async ({ job, complete }) => {
    if (userApproved) {
      await complete(job, ({ continueWith }) =>
        continueWith({ typeName: 'process-request', input: { ... } })
      );
    } else {
      await complete(job, () => ({ rejected: true }));
    }
  },
});
```

## Summary

The job processing model provides:

1. **Transactional integrity**: Jobs are created atomically with application state changes (transactional outbox pattern)
2. **Flexible transaction boundaries**: Atomic mode for quick operations, staged mode for long-running work
3. **Automatic lease renewal**: Workers maintain job ownership during staged processing
4. **Cooperative timeouts**: Users combine signals for cancellation without framework overhead
5. **External completion**: Jobs can be completed by external events, not just workers
