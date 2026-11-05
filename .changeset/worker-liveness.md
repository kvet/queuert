---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/otel": major
"@queuert/dashboard": major
---

The attempt lease moves from jobs to workers. Each in-process worker registers a row in a new `worker` table with a lease that one heartbeat renews (`createInProcessWorker({ leaseConfig: { durationMs, heartbeatMs } })`, defaults 60s / 15s), and a running job is live exactly while its worker's lease is live. A worker that loses its lease aborts its attempts and registers again; an idle worker reclaims expired workers' running jobs as failed attempts with no backoff. The `002_worker_liveness` migration creates the `worker` table, adds `job.attempt_token`, drops `job.attempt_until` and returns every running job to pending, so stop every process on the previous version before running it; on PostgreSQL it gives up after 5s if it cannot take its locks, instead of waiting behind old processes.

- Removed `attemptConfig`, `AttemptConfig`, the `defaults` option of `createInProcessWorker`, `InProcessWorkerDefaults`, `Job.attemptUntil` and the unused `RetryConfig` type; `createInProcessWorker` takes a top-level `backoffConfig` fallback, and `WorkerLeaseConfig` is exported.
- The `workerName` option is replaced by `workerId`, defaulting to the state adapter's new `generateWorkerId` and checked with `validateWorkerId` (throwing the new `InvalidWorkerIdError`); two in-process workers with the same id never run at once, reported through the new `WorkerAlreadyLiveError` and `WorkerLeaseLostError`.
- `start()` registers the worker in the background, and throws when called again before its `stop` resolved; `stop()` reschedules the worker's running jobs and deletes its row; `recoveryBackoffConfig` covers failed registrations, loop errors and restarts.
- Attempt-scoped writes carry an attempt token, so a stale attempt's `complete` writes nothing and throws.
- An idle worker reclaims one expired worker at a time, picked at random among the oldest eight, and reschedules its own running jobs that no attempt runs after an error and otherwise at most once per `leaseConfig.heartbeatMs`.
- A reclaimed job records a serialized `JobAttemptReclaimedError` (new export) as its last attempt error and emits `jobRescheduled`; `jobAttemptReclaimed` carries `reclaimedFrom`, and `workerLeaseLost` is added with the `queuert.worker.lease_lost` metric.
- `createPgStateAdapter` and `createSqliteStateAdapter` take a `workerIdType` option; on PostgreSQL the migration recreates `job.attempt_by` and `job.completed_by` with that type, clearing stored worker IDs, while SQLite keeps them.
- `StateAdapter`, `StateAdapterConfig`, `PgStateAdapter`, `SqliteStateAdapter` and `Job` gain a `TWorkerId` type parameter right after `TJobId`, shifting the later parameters by one.
- PostgreSQL compares schedules and leases against the statement's time rather than the transaction's start.
- `Worker` is exported and the client gains `getWorker`, `getWorkers`, `countWorkers`, `countWorkersByTypeName`, `countRunningJobsByWorkerId`, `listWorkers` and `listWorkerJobs`.
- Custom state adapters implement the new worker methods and attempt-token checks, and drop `extendJobAttempt` and `reclaimExpiredJobAttempts`; the [state adapter interface](https://kvet.github.io/queuert/integrations/state-adapters/#the-stateadapter-interface) lists the contract.
- The dashboard adds Workers pages, links a running job's worker, warns about workers that lost their lease and job types with no live worker, and drops the "Deadline" sort.
