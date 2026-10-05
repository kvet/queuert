---
title: Job Processing Reliability
description: What happens when a handler throws — before, inside, and after the transaction that calls finish — and how the worker decides the attempt's outcome.
sidebar:
  order: 3
---

When your handler throws, the worker reschedules the job with backoff. Your own transaction — the one you pass to `finish` — rolls back through your database client, so its partial work never commits. No defensive error handling is needed inside your handler.

This guide covers the engine's safety guarantees. For user-level error strategies (discriminated unions, compensation, rescheduling), see [Error Handling](../error-handling/). For the architectural overview, see [Job Processing](/queuert/advanced/job-processing/#errors-and-commit-detection).

## The Short Version

1. Queuert opens no transaction around your handler. You open one and call `finish` inside it.
2. If anything throws before that transaction commits, your database client rolls it back — your domain writes and `finish`'s writes go together.
3. After the handler ends, the worker checks the database. If no `finish` committed, the job is rescheduled with exponential backoff and the error is recorded.
4. If `finish` committed, the outcome stands — even if the handler throws afterwards.

The rest of this page walks through each scenario with code examples.

## Error Before the Transaction

Work before your transaction — reads, external API calls — runs without a transaction. If it throws, nothing was written and the job is rescheduled using the processor's `backoffConfig` (or the default exponential backoff).

```ts
'charge-payment': {
  backoffConfig: { initialDelayMs: 1000, multiplier: 2, maxDelayMs: 60_000 },
  attemptHandler: async ({ job, finish }) => {
    const [order] = await sql`SELECT * FROM orders WHERE id = ${job.input.orderId}`;
    if (!order) throw new Error("Order not found"); // rescheduled with backoff

    const { paymentId } = await paymentAPI.charge(order.amount); // may throw

    return withTransactionHooks(async (transactionHooks) =>
      sql.begin(async (txSql) => {
        await txSql`UPDATE orders SET payment_id = ${paymentId} WHERE id = ${order.id}`;
        return finish({ txSql, transactionHooks, output: { paymentId } });
      }),
    );
  },
}
```

Because the external call runs before the transaction, a retry runs it again. Make external side effects idempotent (for example with an idempotency key derived from the job id).

## Error Inside the Transaction

If your transaction callback throws — a constraint fires, a query fails, or `finish` itself throws — your database client rolls the transaction back. That undoes your SQL, the job's completion, and any continuation created via `continueWith`. The job is then rescheduled with backoff.

```ts
'transfer-funds': {
  attemptHandler: async ({ job, finish }) =>
    withTransactionHooks(async (transactionHooks) =>
      sql.begin(async (txSql) => {
        // If the CHECK constraint fires, the transaction rolls back
        // and the job is rescheduled — no corrupted state
        await txSql`UPDATE accounts SET balance = balance - ${job.input.amount}
                  WHERE id = ${job.input.fromId}`;
        await txSql`UPDATE accounts SET balance = balance + ${job.input.amount}
                  WHERE id = ${job.input.toId}`;
        return finish({ txSql, transactionHooks, output: { transferred: true } });
      }),
    ),
}
```

`finish` validates its outcome (output, `continueWith`, blockers) before it writes anything. If you catch an error thrown by `finish` and keep the transaction going, nothing from that call is left half-written.

## Lost Ownership at `finish`

`finish` only writes if this attempt still owns the job. If the attempt's lease lapsed and another worker took the job, or the job was completed or deleted elsewhere, `finish` writes nothing and throws (`JobTakenByAnotherWorkerError`, `JobAlreadyCompletedError` or `JobNotFoundError`). Let it propagate: your transaction rolls back, taking your domain writes with it, and the job stays with whoever owns it now.

## Returning Without a Committed `finish`

A handler that returns without its `finish` committing — for example because `finish` ran in a savepoint you rolled back — fails the attempt with `Attempt handler returned without a committed finish`. The job is rescheduled with backoff, exactly as if the handler had thrown.

## Error After `finish` Committed

Once your transaction has committed, the outcome is final. If the handler throws afterwards, the error is recorded for the attempt, but the completion is **not** rolled back and the job is **not** rescheduled.

```ts
'send-receipt': {
  attemptHandler: async ({ job, finish }) => {
    const result = await withTransactionHooks(async (transactionHooks) =>
      sql.begin(async (txSql) => finish({ txSql, transactionHooks, output: { sent: true } })),
    );
    await analytics.track("receipt-sent"); // a throw here does not undo the completion
    return result;
  },
}
```

Keep work that must succeed for the job to count as done inside the transaction (or before it). Work after the commit is your responsibility.

## Intermediate Transactions

A handler can commit intermediate work in its own transactions before the one that calls `finish` — for example deleting rows in batches. Those transactions are not tied to the attempt: they commit even if the handler later throws or the attempt is lost, and a later attempt runs them again. Make them idempotent.

## What This Means in Practice

- **Any error before `finish` commits → reschedule with backoff.** Whether it occurs before your transaction, inside it, or at commit — the job is rescheduled. Backoff follows the processor's `backoffConfig` or the default (10s → 20s → 40s → ... → 300s cap).
- **No corrupted state.** Your transaction is all-or-nothing: domain writes, the job's completion and its continuation commit together or not at all.
- **No orphaned continuations.** If the transaction that called `finish({ continueWith })` rolls back, the continuation job is rolled back with it.
- **Blocked jobs stay blocked.** If a blocker chain's completion is rolled back, dependent jobs remain correctly blocked.
- **Errors after a committed `finish` don't undo it.** The outcome stands; the error is only recorded.
- **No defensive `try/catch` needed.** Let exceptions propagate — the worker handles them.
- **Jobs retry indefinitely.** There is no maximum retry count. Use [discriminated unions or compensation patterns](../error-handling/) to handle permanently failing jobs.

## See Also

See [examples/showcase-error-recovery](https://github.com/kvet/queuert/tree/main/examples/showcase-error-recovery) for a complete working example. See also [Error Handling](../error-handling/) for user-level error strategy, [Timeouts](../timeouts/) for attempt leases, and the [Job Processing](/queuert/advanced/job-processing/) reference.
