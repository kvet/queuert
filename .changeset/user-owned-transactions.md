---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/otel": major
---

Job processing now runs in your own transaction. Queuert no longer opens transactions around an attempt: the handler does its work, opens a transaction with your database client, calls `finish({ ...txCtx, transactionHooks, output | continueWith | reschedule })` inside it, and returns what `finish` returned, so the outcome commits or rolls back together with your domain writes. The worker's own bookkeeping (acquire, heartbeat, reclaim, rescheduling a failed attempt) runs as single autocommit statements conditional on the attempt still owning the job, and every attempt holds a lease from acquisition that the heartbeat renews until the handler ends.

- `prepare`, `step`, `complete`, the atomic and staged processing modes and auto-setup are removed; migrate `complete(async ({ finish, transactionHooks, ...txCtx }) => finish({ output }))` to `withTransactionHooks(async (transactionHooks) => db.transaction(async (tx) => finish({ tx, transactionHooks, output })))`, move `prepare` reads before or into that transaction, and move `step` work into your own separate transactions, which are not tied to the attempt's ownership and must be idempotent.
- `finish` is now passed to the handler directly and takes one options object with the transaction context and `transactionHooks` (both required) plus exactly one of the existing `{ output }`, `{ continueWith }` or `{ reschedule }` outcomes. It writes nothing if the attempt no longer owns the job and throws `JobTakenByAnotherWorkerError`, `JobAlreadyCompletedError` or `JobNotFoundError`, and it is safe to call again in a retried transaction (the last call wins).
- `job.blockers` is removed; job types with blockers receive `getBlockers(txCtx?)`, which reads the completed blocker chains on demand, optionally inside your transaction.
- A handler that returns without a committed `finish` fails the attempt and is rescheduled with backoff, and an error thrown after a committed `finish` is recorded but no longer rolls the completion back.
- The worker trusts the `finish` result the handler returns once its `transactionHooks` flush, so a successful attempt costs no extra statement; a `finish` rolled back in a savepoint must sit inside `transactionHooks.withSavepoint` (or `createSavepoint`) so its result is not trusted.
- A crash now always consumes the attempt and is recovered by reclaim once the lease expires; a reclaimed job gets `lastAttemptAt` and a `JobAttemptExpiredError: …` `lastAttemptError`.
- Ownership checks now include the attempt number, fixing a worker with `concurrency > 1` that could re-acquire a job it had lost and finish it from the stale slot.
- On PostgreSQL, job acquisition locks only the job row, so a transaction that holds a chain's head (for example while adding a blocker on that chain) no longer holds back the chain's pending job.
- On PostgreSQL, every transaction you pass to `finish` or to client methods must run at READ COMMITTED (the default); REPEATABLE READ and SERIALIZABLE are not supported.
- On SQLite, every transaction you pass to `finish` must be opened while holding the provider's `AsyncRwLock` write lock, as the provider's own `withTransaction` does.
- `AttemptMiddleware` keeps only `wrapHandler`, which must return what `next` returned; `wrapPrepare`, `wrapStep` and `wrapComplete` are removed, and its type parameters shrink accordingly.
- Each attempt is a single span: the `prepare`, `step` and `complete` child spans, the `queuert.step.index` attribute and `JobAttemptSpanHandle.startPrepare`/`startStep`/`startComplete` are removed.
- `StateAdapter` contract (custom adapters): `withSavepoint` is removed from adapters and state providers, `hasBlockers` from `startJobAttempt` results and `hasBlockedJobs` from `completeJobs` results; `startJobAttempt` takes `timeoutMsByTypeName` instead of `typeNames` and sets the lease; `extendJobAttempt` takes a `fence: { attempt, workerId }`; `completeJobs`, `continueJobs` and `rescheduleJobs` accept a per-job `fence` and must write all or nothing; `reclaimExpiredJobAttempt` takes the `lastAttemptError` to stamp; `completeJobs` no longer requires a pre-locked head; and the worker-owned methods accept an optional `txCtx` for autocommit.
