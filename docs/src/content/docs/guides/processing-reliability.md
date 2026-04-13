---
title: Job Processing Reliability
description: How Queuert keeps jobs safe when errors occur — savepoints, transaction poisoning protection, automatic rollback, and rescheduling.
sidebar:
  order: 3
---

When your code throws during job processing, the engine catches the error, rolls back any partial work, and reschedules the job with backoff. This happens automatically — no defensive error handling is needed inside your callbacks.

This guide covers the engine's safety guarantees. For user-level error strategies (discriminated unions, compensation, rescheduling), see [Error Handling](../error-handling/). For the architectural overview of savepoints and transaction poisoning, see [Job Processing](/queuert/advanced/job-processing/#error-recovery-and-savepoints).

## The Short Version

1. Both `prepare` and `complete` callbacks run inside **database savepoints**.
2. If a callback throws, the savepoint **rolls back** any partial SQL it executed.
3. The outer transaction stays healthy, so the engine can **reschedule** the job with exponential backoff.
4. This works regardless of _where_ the error occurs — in `prepare`, between phases, in `complete`, or after `complete` returns.

The rest of this page walks through each scenario with code examples.

## Error in Prepare Callback

The `prepare` callback runs inside a savepoint. If it throws, the savepoint rolls back and the job is rescheduled using the processor's `backoffConfig` (or the default exponential backoff).

```ts
'charge-payment': {
  backoffConfig: { initialDelayMs: 1000, multiplier: 2, maxDelayMs: 60_000 },
  attemptHandler: async ({ job, prepare, complete }) => {
    const order = await prepare({ mode: "staged" }, async ({ sql }) => {
      // If this throws (constraint violation, missing row, etc.),
      // the savepoint rolls back and the job retries after backoff
      const [row] = await sql`SELECT * FROM orders WHERE id = ${job.input.orderId}`;
      if (!row) throw new Error("Order not found");
      return row;
    });

    const { paymentId } = await paymentAPI.charge(order.amount);

    return complete(async ({ sql }) => {
      await sql`UPDATE orders SET payment_id = ${paymentId} WHERE id = ${order.id}`;
      return { paymentId };
    });
  },
}
```

In **atomic mode**, the prepare savepoint rolls back within the same transaction that acquired the job, and the reschedule commits in that transaction. In **staged mode**, the behavior is the same — the prepare transaction has not committed yet, so the rollback + reschedule happen in one transaction.

## Error in Complete Callback

The `complete` callback also runs inside a savepoint. If it throws, the savepoint rolls back — undoing any SQL the callback executed, the `completeJob` call, and any continuation jobs created via `continueWith` — and the job is rescheduled with backoff.

```ts
'transfer-funds': {
  attemptHandler: async ({ job, complete }) => {
    return complete(async ({ sql }) => {
      // If the CHECK constraint fires, the savepoint rolls back
      // and the job is rescheduled — no corrupted state
      await sql`UPDATE accounts SET balance = balance - ${job.input.amount}
                WHERE id = ${job.input.fromId}`;
      await sql`UPDATE accounts SET balance = balance + ${job.input.amount}
                WHERE id = ${job.input.toId}`;
      return { transferred: true };
    });
  },
}
```

> **Tip:** The outer transaction — which holds the job lease — commits successfully with the reschedule, even though the savepoint rolled back. The job returns to pending status and retries after backoff.

## Error Between Prepare and Complete

In **staged mode**, if an error occurs after `prepare` commits but before `complete` runs (typically a failed external API call), the job is rescheduled with backoff. Since prepare already committed, its side-effects persist — the complete phase retries in a fresh transaction on the next attempt.

```ts
'sync-external': {
  attemptHandler: async ({ job, prepare, complete }) => {
    const data = await prepare({ mode: "staged" }, async ({ sql }) => {
      return (await sql`SELECT * FROM items WHERE id = ${job.input.id}`)[0];
    });
    // Prepare committed. If the API call below throws, the job retries
    // and prepare runs again in a new transaction.

    const externalId = await externalAPI.sync(data); // may throw

    return complete(async ({ sql }) => {
      await sql`UPDATE items SET external_id = ${externalId} WHERE id = ${data.id}`;
      return { externalId };
    });
  },
}
```

In **atomic mode**, prepare and complete share the same transaction, so any error between them rolls back the entire transaction (including prepare's work) and reschedules.

## Error After Complete

The `complete` savepoint is only released when the handler returns successfully. If you `await complete()` and then throw, the completion — including `completeJob`, `unblockJobs`, continuation jobs, and any SQL you ran inside the callback — is atomically rolled back. The job is rescheduled as if `complete` never happened.

> **Note:** In **staged mode**, prepare's committed work persists across retries. Design your staged handlers so that prepare's side-effects are safe to keep when the complete phase retries.

## What This Means in Practice

- **Any unhandled error → reschedule with backoff.** Whether the error occurs in `prepare`, between phases, in `complete`, or after `complete` — the job is always rescheduled. Backoff follows the processor's `backoffConfig` or the default (10s → 20s → 40s → ... → 300s cap).
- **No corrupted state.** Savepoints ensure that partial SQL work inside callbacks is never committed when an error occurs.
- **No orphaned continuations.** If `continueWith` was called inside `complete` and the handler throws afterward, both the continuation job and the completion are rolled back.
- **Blocked jobs stay blocked.** If a blocker job's completion is rolled back, dependent jobs remain correctly blocked.
- **No defensive `try/catch` needed.** Let exceptions propagate naturally inside `prepare` and `complete` callbacks — the engine handles them.
- **Jobs retry indefinitely.** There is no maximum retry count. Use [discriminated unions or compensation patterns](../error-handling/) to handle permanently failing jobs.

## See Also

See [examples/showcase-error-recovery](https://github.com/kvet/queuert/tree/main/examples/showcase-error-recovery) for a complete working example. See also [Error Handling](../error-handling/) for user-level error strategy, [Processing Modes](../processing-modes/) for atomic vs. staged mode details, and [Job Processing](/queuert/advanced/job-processing/) reference.
