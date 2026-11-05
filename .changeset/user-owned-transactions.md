---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/otel": major
---

Job processing runs in your own transaction. The handler does its work, opens a transaction with your database client, calls `complete({ ...txCtx, transactionHooks, output | continueWith | reschedule })` inside it and returns the result, so the outcome commits or rolls back together with your domain writes. Move the work from `prepare` and the old `complete` callback into your own transaction; the worker's own bookkeeping runs as atomic writes conditional on the attempt still owning the job.

- Removed `prepare`, `step`, the old `complete` callback, the atomic and staged processing modes and auto-setup; `AttemptMiddleware` keeps only `wrapHandler`, which is required and returns `next`'s result.
- `complete` (formerly `finish`) requires the transaction context and `transactionHooks`, throws `JobTakenByAnotherWorkerError`, `JobAlreadyCompletedError` or `JobNotFoundError` when the attempt no longer owns the job, and succeeds at most once per `transactionHooks` (open `withTransactionHooks` outside your transaction, once per try); wrap a `complete` that may be rolled back to a savepoint in `transactionHooks.withSavepoint`.
- A handler that returns without a committed `complete` is rescheduled with backoff; an error thrown after a committed `complete` is reported as a `workerError` and keeps the completion.
- Rescheduling after a failed attempt notifies workers like every other reschedule.
- PostgreSQL: job acquisition locks only the job row, so a transaction holding a chain's head does not hold back its later jobs.
- SQLite: every transaction you pass to `complete` or to client methods must be serialized with the provider's own transactions, for example by holding its `AsyncRwLock` write lock.
- `@queuert/otel`: each attempt is a single span; the `prepare`, `step` and `complete` child spans and the `queuert.step.index`, `queuert.rescheduled_at` and `queuert.rescheduled_after_ms` attributes are removed (use the `queuert.job.rescheduled` metric).
- Custom observability adapters, state providers and state adapters: the attempt span handle drops `startPrepare` and `startComplete`, `withSavepoint` is removed from the providers and `StateAdapter`, `completeJobs` drops `hasBlockedJobs`, and `startJobAttempts` and `rescheduleJobs` must work without a `txCtx`.
- Workerless completion renames its callback argument the same way: `completeJob(job, async ({ complete }) => complete({ output }))`.
- The `chain_created` and `job_created` logs and events report the parsed input (the stored `job.input`).
