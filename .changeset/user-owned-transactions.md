---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/otel": major
"@queuert/dashboard": patch
---

Job processing now runs in your own transaction. Queuert no longer opens transactions around an attempt: the handler does its work, opens a transaction with your database client, calls `complete({ ...txCtx, transactionHooks, output | continueWith | reschedule })` inside it, and returns what `complete` returned, so the outcome commits or rolls back together with your domain writes. To migrate, move the work from `prepare` and the old `complete` callback into your own transaction and call `complete` there (it replaces the `finish` the old callback received); transactions you open before it are not tied to the attempt, so keep them idempotent. The worker's own bookkeeping (acquire, heartbeat, reclaim, rescheduling a failed attempt) runs as single autocommit statements conditional on the attempt still owning the job, and the heartbeat extends each attempt until the handler ends or its `complete` commits.

- Removed `prepare`, `step`, the old `complete` callback, the atomic and staged processing modes and auto-setup. `AttemptMiddleware` keeps only `wrapHandler`, which is now required and must return what `next` returned; `wrapPrepare`, `wrapStep` and `wrapComplete` are removed and its type parameters shrink accordingly.
- `complete` (formerly `finish`) is passed to the handler directly and takes the transaction context and `transactionHooks` (both required) plus exactly one outcome. It rejects a context outside an open transaction, writes nothing and throws `JobTakenByAnotherWorkerError`, `JobAlreadyCompletedError` or `JobNotFoundError` when the attempt no longer owns the job, and succeeds at most once per `transactionHooks`, so a loop that retries your transaction must open `withTransactionHooks` once per try.
- The worker trusts the `complete` result the handler returns once its `transactionHooks` flush, so a successful attempt costs no extra statement. Keep `withTransactionHooks` outside your transaction, and wrap a `complete` that may be rolled back in a database savepoint in `transactionHooks.withSavepoint`.
- A handler that returns without a committed `complete` fails the attempt and is rescheduled with backoff. An error thrown after a committed `complete` no longer rolls the completion back; it is reported as a `workerError`.
- Rescheduling a job after a failed attempt now notifies workers like every other reschedule, so an idle worker picks up the retry once its backoff elapses instead of waiting for its next poll.
- A crash always consumes the attempt and is recovered by reclaim once the attempt expires.
- PostgreSQL: job acquisition locks only the job row, so a transaction holding a chain's head (for example while adding a blocker on that chain) no longer holds back the chain's later jobs. Every transaction you pass to `complete` or to client methods must run at READ COMMITTED (the default).
- SQLite: every transaction you pass to `complete` or to client methods must be serialized with the provider's own transactions, for example by holding its `AsyncRwLock` write lock as its `withTransaction` does.
- `@queuert/otel`: each attempt is a single span. The `prepare`, `step` and `complete` child spans, the `queuert.step.index` attribute and `JobAttemptSpanHandle.startPrepare`/`startComplete` are removed, and a failed attempt's span no longer carries `queuert.rescheduled_at` or `queuert.rescheduled_after_ms` (`JobAttemptSpanResult` drops `rescheduledAt` and `rescheduledAfterMs`); use the `queuert.job.rescheduled` metric and the `jobRescheduled` event instead.
- Custom state providers: `withSavepoint` is removed from `PgStateProvider` and `SqliteStateProvider`.
- Workerless completion renames its callback argument the same way: `completeJob(job, async ({ complete }) => complete({ output }))`.
