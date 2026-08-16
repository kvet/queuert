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
    await client.createChain({
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

Attempt handlers split processing into phases: `prepare` reads the data the attempt needs, the handler does its work in between, and `complete` writes exactly one outcome — an output that ends the chain, or a continuation that extends it with a successor job. The split is what lets an attempt run atomically in a single transaction or stage long-running work between two.

### Auto-Setup (Default)

Most jobs don't need `prepare`. Call `complete` directly and auto-setup infers the mode:

- **Synchronous `complete`** (called immediately, no prior `await`): atomic mode — single transaction wraps everything
- **Async work before `complete`**: staged mode -- heartbeat active between async work and complete
- Accessing `prepare` after auto-setup throws: "Prepare cannot be accessed after auto-setup"

See [Processing Modes](../../guides/processing-modes/) for examples and a decision flowchart.

### Explicit Modes

For more control, call `prepare` explicitly:

- **Atomic mode**: Prepare and complete run in the same transaction. Rarely needed since calling `complete` directly achieves the same result with less ceremony.
- **Staged mode**: Prepare runs in one transaction, long-running work happens outside, then complete runs in another transaction. The worker automatically extends the attempt between phases. Implement the processing phase idempotently as it may retry if the worker crashes.

### Intermediate Transactions with `step`

Handlers can call `step` to perform intermediate transactional work — each call opens a fresh guarded transaction with attempt verification. This is useful for batched operations like bulk deletes where holding a single long-lived transaction would be impractical. If `prepare` hasn't been called, `step` automatically enters staged mode. `step` is not reachable once `complete` has started — work that must observe the terminal transition belongs inside the complete transaction. See [Processing Modes — Step](../../guides/processing-modes/#intermediate-transactions-with-step).

## Error Recovery and Savepoints

Both the `prepare` and `complete` callbacks run inside database savepoints. This is the mechanism that keeps jobs safe when user code throws.

### Why Savepoints

A naive approach would run user callbacks directly inside the job's transaction. The problem: if user code throws after executing partial SQL, the transaction is **poisoned** — most databases reject further statements on a transaction that has seen an error. The engine couldn't even reschedule the job because the reschedule SQL would fail on the same broken transaction.

Savepoints solve this. A savepoint is a checkpoint within a transaction. If code inside the savepoint throws, the database rolls back to that checkpoint — undoing the partial work — while the outer transaction remains healthy. The engine can then reschedule the job and commit normally.

### How It Works

```d2
...@../_classes.d2

direction: down

acquire_txn: "Transaction (acquires job)" {
  class: txn

  prepare: "Savepoint — prepare callback" {
    class: savepoint
    body: "User SQL…\nthrows? rollback to savepoint" { class: step; width: 320; height: 80 }
  }
}

async_work: "… async work (staged mode only) …\nattempt auto-extends between transactions" { class: job-muted; width: 420; height: 80 }

complete_txn: "Transaction (completes job)" {
  class: txn

  complete: "Savepoint — complete callback" {
    class: savepoint
    body: "User SQL…\ncommit: writes the outcome\nthrows? rollback to savepoint" { class: step; width: 320; height: 100 }
  }
}

result: "On error: reschedule with backoff\nOn success: commit" { class: job-done; width: 400; height: 90 }

acquire_txn  -> async_work    { class: flow }
async_work   -> complete_txn { class: flow }
complete_txn -> result       { class: flow }
```

On any unhandled error the job is rescheduled with exponential backoff (default: 10 s → 20 s → 40 s → ... capped at 300 s). There is no maximum retry count — jobs retry indefinitely. Use [discriminated unions or compensation patterns](../../guides/error-handling/) to handle permanently failing jobs.

See [Job Processing Reliability](../../guides/processing-reliability/) for per-phase error scenarios with code examples.

### Abort Signal and Reasons

Every attempt handler receives a `signal` (`TypedAbortSignal<JobAbortReason>`) that is aborted when the job should stop. The `signal.reason` distinguishes the cause:

| Reason                      | Meaning                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `"taken_by_another_worker"` | Another worker acquired the job (attempt expired and was released)                 |
| `"not_found"`               | The job no longer exists in the database                                           |
| `"already_completed"`       | The job was already completed                                                      |
| `"error"`                   | An internal error occurred during attempt extension                                |
| `"worker_stopping"`         | The worker is shutting down — the job is still valid and the attempt is still held |

The first four reasons indicate the job is no longer owned by this worker — handlers should stop immediately. `"worker_stopping"` is different: the job remains valid, but the worker is draining, so handlers should check `signal.reason` and wrap up quickly. Every attempt must still end in an outcome: call `complete`, or throw so the attempt is rescheduled with backoff. A handler that simply returns without completing fails the attempt.

```typescript
attemptHandler: async ({ signal, complete }) => {
  for (const item of items) {
    if (signal.aborted && signal.reason === "worker_stopping") {
      break; // finish early, complete with partial results
    }
    await processItem(item);
  }
  return complete(async ({ finish }) => finish({ output: { processed: items.length } }));
},
```

## See Also

- [Job Processing Reliability](../../guides/processing-reliability/) — Savepoint protection, automatic rollback
- [Client API](/queuert/api/core/type-aliases/client/) — Mutation methods, query methods, awaitChain
- [In-Process Worker](../in-process-worker/) — Worker lifecycle, attempt management, expired attempt reclamation
- [Adapters](../adapters/) — StateAdapter context architecture
- [`showcase-signals`](https://github.com/kvet/queuert/tree/main/examples/showcase-signals) — Runnable example: `already_completed` via external `completeChain`, `worker_stopping` via graceful shutdown
