# Job Processing Model

## Overview

This document describes how Queuert processes jobs: transactional design, prepare/complete pattern, and timeout philosophy.

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

Attempt handlers split processing into distinct phases to support both atomic (single-transaction) and staged (long-running) operations.

### Attempt Handler Signature

```typescript
attemptHandler: async ({ signal, job, prepare, complete }) => { ... }
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

This means simple attempt handlers default to staged mode:

```typescript
attemptHandler: async ({ job, complete }) => {
  // Transaction already closed, lease renewal running
  return complete(() => output);
};
```

## Timeouts

Queuert does not provide built-in soft timeout functionality. This is intentional:

1. **Userland solution is trivial**: Combine `AbortSignal.timeout()` with the existing `signal` parameter using `AbortSignal.any()`
2. **Lease mechanism is the hard timeout**: If a job doesn't complete within `leaseMs`, the reaper reclaims it and another worker retries

### Cooperative Timeouts

Users implement cooperative timeouts by combining `AbortSignal.timeout()` with the existing `signal` parameter using `AbortSignal.any()`.

### Hard Timeouts

For hard timeouts (forceful termination), the lease mechanism already handles this:

- Configure `leaseMs` appropriately for the job type
- If the job doesn't complete or renew its lease in time, the reaper reclaims it
- Another worker can then retry the job

## See Also

- [Workerless Completion](workerless-completion.md) — Completing jobs without a worker
- [Client](client.md) — Client API
- [In-Process Worker](in-process-worker.md) — Worker lifecycle, leasing, reaper
- [Adapters](adapters.md) — StateAdapter context architecture
