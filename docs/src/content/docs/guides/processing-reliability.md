---
title: Job Processing Reliability
description: How Queuert keeps jobs safe when errors occur — transactional completion, automatic rollback, and rescheduling.
sidebar:
  order: 3
---

When your code throws during job processing, your transaction rolls back any partial work and the worker reschedules the job with backoff. This happens automatically — no defensive error handling is needed inside your handler.

This guide covers the engine's safety guarantees. For user-level error strategies (discriminated unions, compensation, rescheduling), see [Error Handling](../error-handling/). For the architectural overview, see [Job Processing](/queuert/advanced/job-processing/#errors-and-commit-detection).

## The Short Version

1. Your handler opens a transaction with your database client and calls `complete` inside it.
2. If anything throws before that transaction commits, your database client **rolls back** your SQL together with the job's completion.
3. If no `complete` committed, the worker **reschedules** the job with exponential backoff.
4. This works regardless of _where_ the error occurs — before your transaction or inside it. Once `complete` has committed, the outcome stands.

The rest of this page walks through each scenario with code examples.

## Error Before the Transaction

Work before your transaction — reads, external API calls — runs without a transaction. If it throws, nothing was written and the job is rescheduled using the processor's `backoffConfig` (or the default exponential backoff).

```ts
'charge-payment': {
  backoffConfig: { initialDelayMs: 1000, multiplier: 2, maxDelayMs: 60_000 },
  attemptHandler: async ({ job, complete }) => {
    // If this throws (missing row, etc.), the job retries after backoff
    const [order] = await sql`SELECT * FROM orders WHERE id = ${job.input.orderId}`;
    if (!order) throw new Error("Order not found");

    const { paymentId } = await paymentAPI.charge(order.amount);

    return withTransactionHooks(async (transactionHooks) =>
      sql.begin(async (txSql) => {
        await txSql`UPDATE orders SET payment_id = ${paymentId} WHERE id = ${order.id}`;
        return complete({ txSql, transactionHooks, output: { paymentId } });
      }),
    );
  },
}
```

Because the external call runs before the transaction, a retry runs it again. Make external side effects idempotent (for example with an idempotency key derived from the job id).

## Error Inside the Transaction

If your transaction callback throws, your database client rolls the transaction back — undoing any SQL you executed, the job completion, and any continuation jobs created via `continueWith` — and the job is rescheduled with backoff.

```ts
'transfer-funds': {
  attemptHandler: async ({ job, complete }) =>
    withTransactionHooks(async (transactionHooks) =>
      sql.begin(async (txSql) => {
        // If the CHECK constraint fires, the transaction rolls back
        // and the job is rescheduled — no corrupted state
        await txSql`UPDATE accounts SET balance = balance - ${job.input.amount}
                  WHERE id = ${job.input.fromId}`;
        await txSql`UPDATE accounts SET balance = balance + ${job.input.amount}
                  WHERE id = ${job.input.toId}`;
        return complete({ txSql, transactionHooks, output: { transferred: true } });
      }),
    ),
}
```

The same holds for a throw after `complete` returned but before the transaction commits: the completion is part of your transaction, so it rolls back together with your writes.

## Intermediate Transactions

A handler can commit work in its own transactions before the one that calls `complete`. Those transactions are not tied to the attempt: if an error occurs after one commits (typically a failed external API call), the job is rescheduled with backoff, its side-effects persist, and the next attempt runs it again.

```ts
'sync-external': {
  attemptHandler: async ({ job, complete }) => {
    const data = await sql.begin(async (txSql) => {
      const [item] = await txSql`SELECT * FROM items WHERE id = ${job.input.id} FOR UPDATE`;
      await txSql`UPDATE items SET sync_started_at = now() WHERE id = ${item.id}`;
      return item;
    });
    // That transaction committed. If the API call below throws, the job retries
    // and the transaction above runs again on the next attempt.

    const externalId = await externalAPI.sync(data); // may throw

    return withTransactionHooks(async (transactionHooks) =>
      sql.begin(async (txSql) => {
        await txSql`UPDATE items SET external_id = ${externalId} WHERE id = ${data.id}`;
        return complete({ txSql, transactionHooks, output: { externalId } });
      }),
    );
  },
}
```

> **Note:** Intermediate transactions commit even if the attempt is later lost to another worker. Design them so that their side-effects are safe to keep when the job retries.

## Error After `complete` Committed

Once the transaction that called `complete` has committed, the outcome is final. If the handler throws afterwards, the error is reported as a worker error (`workerError`), but the completion is not rolled back and the job is not rescheduled.

```ts
'notify-account': {
  attemptHandler: async ({ job, complete }) => {
    const result = await withTransactionHooks(async (transactionHooks) =>
      sql.begin(async (txSql) =>
        complete({ txSql, transactionHooks, output: { notified: true } }),
      ),
    );

    // A throw here does not undo the completion
    await notificationAPI.send(job.input.accountId);

    return result;
  },
}
```

Keep work that must succeed for the job to count as done inside the transaction (or before it). Work after the commit is your responsibility.

## What This Means in Practice

- **Any unhandled error before the commit → reschedule with backoff.** Whether the error occurs before your transaction or inside it — the job is always rescheduled. Backoff follows the processor's `backoffConfig` or the default (10s → 20s → 40s → ... → 300s cap). A handler that returns without a committed `complete` is rescheduled the same way.
- **No corrupted state.** Your transaction ensures that partial SQL work is never committed when an error occurs.
- **No orphaned continuations.** If `complete` was called with `continueWith` and the transaction throws afterward, both the continuation job and the completion are rolled back.
- **Blocked jobs stay blocked.** If a blocker job's completion is rolled back, dependent jobs remain correctly blocked.
- **No lost-attempt writes.** `complete` only writes while this attempt still owns the job. If its worker lost its lease and another worker reclaimed the job, or the job was completed or deleted elsewhere, `complete` writes nothing and throws (`JobTakenByAnotherWorkerError`, `JobAlreadyCompletedError` or `JobNotFoundError`), so your transaction rolls back.
- **No defensive `try/catch` needed.** Let exceptions propagate naturally — the worker handles them.
- **Jobs retry indefinitely.** There is no maximum retry count. Use [discriminated unions or compensation patterns](../error-handling/) to handle permanently failing jobs.

## See Also

See [examples/showcase-error-recovery](https://github.com/kvet/queuert/tree/main/examples/showcase-error-recovery) for a complete working example. See also [Error Handling](../error-handling/) for user-level error strategy, [Timeouts](../timeouts/) for cooperative timeouts and the worker lease, and [Job Processing](/queuert/advanced/job-processing/) reference.
