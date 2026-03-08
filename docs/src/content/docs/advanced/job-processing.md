---
title: Job Processing
description: Prepare/complete pattern, atomic and staged modes.
sidebar:
  order: 4
---

## Overview

This document describes how Queuert processes jobs: transactional design, prepare/complete pattern, and timeout philosophy.

## Transactional Design

Queuert's core design principle is that **jobs are created inside the same database transaction as your application state changes**. This follows the transactional outbox pattern:

```typescript
await withTransactionHooks(async (transactionHooks) =>
  db.transaction(async (tx) => {
    // Application state change
    const image = await tx.images.create({ ... });

    // Job creation in the same transaction
    // The transaction context property name matches your StateProvider
    await client.startJobChain({
      tx,
      transactionHooks,
      typeName: "process-image",
      input: { imageId: image.id },
    });
  }),
);
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

Observability events (metrics, span ends, logs) emitted during the prepare and complete phases are transactional — they are buffered and only flushed after the transaction commits. If the transaction rolls back, no observability events leak out.

## Prepare/Complete Pattern

Attempt handlers split processing into distinct phases to support both atomic (single-transaction) and staged (long-running) operations. See `AttemptHandler` TSDoc for the full handler signature and `AttemptPrepareOptions` for mode details.

### Auto-Setup (Default)

Most jobs don't need `prepare`. Call `complete` directly and auto-setup infers the mode:

- **Synchronous `complete`** (called immediately, no prior `await`): atomic mode — single transaction wraps everything
- **Async work before `complete`**: staged mode — lease renewal active between async work and complete
- Accessing `prepare` after auto-setup throws: "Prepare cannot be accessed after auto-setup"

See [Processing Modes](../../guides/processing-modes/) for examples and a decision flowchart.

### Explicit Modes

For more control, call `prepare` explicitly:

- **Atomic mode**: Prepare and complete run in the same transaction. Rarely needed since calling `complete` directly achieves the same result with less ceremony.
- **Staged mode**: Prepare runs in one transaction, long-running work happens outside, then complete runs in another transaction. The worker automatically renews the job lease between phases. Implement the processing phase idempotently as it may retry if the worker crashes.

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

- [Client API](/queuert/reference/queuert/client/) — Mutation methods, query methods, awaitJobChain
- [In-Process Worker](../in-process-worker/) — Worker lifecycle, leasing, reaper
- [Adapters](../adapters/) — StateAdapter context architecture
