---
"queuert": major
"@queuert/postgres": minor
"@queuert/sqlite": minor
"@queuert/mysql": minor
"@queuert/redis": minor
"@queuert/otel": minor
---

Processors can opt into batches with the experimental `batchAttemptHandler` and `batchLimit`, whose API may change in a minor release: the handler receives up to `batchLimit` due jobs of its type in one call, never waiting for more, each with its own attempt and its own `job.signal`. The handler settles them with `applyJobOutcomes`, together in one transaction or each in its own: a call that names a lost job throws, and letting its transaction roll back undoes the call for every job it names, while jobs settled in different transactions do not share a fate, and jobs left unsettled when the handler ends fail. A batch takes one worker runner concurrency slot until its handler returns.

- Added `batchAttemptHandler`, with a required `batchLimit`, to processors as the alternative to `attemptHandler`; it receives `jobs`, `applyJobOutcomes({ ...txCtx, items })` with items naming their job like `client.applyJobOutcomes`, and `fenceJobs({ ...txCtx, jobs })`.
- Added the `{ fail: error }` outcome to a batched handler's `applyJobOutcomes`, which fails a single job with backoff.
- Added the `jobAttemptBatchSize` hook to `ObservabilityAdapter`, which custom adapters must implement: it is called once per attempt handler call with the number of jobs received, and the OpenTelemetry adapter records it as the `queuert.job.attempt.batch_size` histogram.
- Added `JobsTakenByAnotherWorkerError`, thrown by a batched handler's `applyJobOutcomes` and `fenceJobs`, which also throw `JobsAlreadyCompletedError` and `JobsNotFoundError`, listing the lost jobs: the deleted ones if any, else the completed ones, else the reclaimed ones.
- Attempt middleware's `wrapHandler` receives `jobs`, one job or the whole batch, instead of `job`.
- `StateAdapter.startJobAttempts` takes a `batchLimits` map from job type name to the most jobs per batch in place of `typeNames`, and claims whole batches of a type's oldest due jobs, up to `limit` batches; the PostgreSQL, SQLite, MySQL and Redis state adapters claim every batch in one statement or script.
- An attempt's `jobAttemptDuration` and span end when its outcome commits rather than when the handler returns.
- Each client write, and each `applyJobOutcome` or `applyJobOutcomes` call an attempt handler makes, registers one `onTransactionCommit` and one `onTransactionRollback` callback on the state provider however many jobs it writes, rather than a pair per job and event.
- `createProcessors` throws a `TypeError` listing every invalid registry or processor `backoffConfig`, which `createWorkerRunner` checked before, every invalid processor `batchLimit`, and every processor without exactly one of `attemptHandler` and `batchAttemptHandler`.
