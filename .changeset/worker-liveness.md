---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/otel": major
"@queuert/dashboard": major
---

Attempt ownership moves from the job row to the worker: each in-process worker registers a row in a new `worker` table and renews one lease per worker (`createInProcessWorker({ lease: { durationMs, heartbeatMs } })`, defaults 60s / 15s), instead of one heartbeat per running job. When a worker loses its lease it aborts its attempts' signals, waits for every attempt to end, and the in-process worker starts the next worker under a fresh id; a running job whose worker's lease expired is reclaimed by any worker, whatever its type, and recorded as a failed attempt with a serialized `JobAttemptReclaimedError`. The `002_worker_liveness` migration drops `attempt_until`, so every previous-version process — workers and clients — must be stopped before it runs.

- `attemptConfig` (processor-level and `defaults.attemptConfig`) and `AttemptConfig` are removed; `WorkerLeaseConfig` is added.
- `Job.attemptUntil` is removed, and `listJobs` no longer orders running jobs by `attemptUntil`.
- State adapters take `generateWorkerId` / `validateWorkerId`; a rejected id throws `InvalidWorkerIdError`.
- `workerName` accepts any non-empty string and is stored as the worker's name instead of being embedded in its id.
- A reclaimed job records the failed attempt: `lastAttemptAt` is set and `lastAttemptError` holds a serialized `JobAttemptReclaimedError` (new export, carrying `reclaimedBy`), and the dashboard shows it with the failed-last-attempt warning.
- `workerLeaseLost` is added; worker events carry `workerName`; `jobAttemptReclaimed` carries `reclaimedFrom`.
- Logs and metrics follow: `worker_lease_lost` (warn) and `queuert.worker.lease_lost` are added, and `job_attempt_reclaimed` logs "Reclaimed job attempt".
- Custom state adapters implement `startWorker` (taking `typeNames` and `concurrency`), `extendWorkerLease`, `stopWorker`, `getWorkers`, `listWorkers`, `countWorkersByTypeNames` and `listWorkerJobs`, drop `extendJobAttempt`, and take `typeNames` in `startJobAttempts`; `reclaimExpiredJobAttempts` reclaims jobs of any type and returns the worker each was reclaimed from; both it and `stopWorker` take a `lastAttemptError` and stamp `lastAttemptAt` and `lastAttemptError` on every job they reclaim.
- A claim or fallback reschedule that throws stops the worker gracefully: it takes no new jobs until its attempts end, `stopWorker` reclaims the jobs left running under it, and the next worker starts after the `recoveryBackoffConfig` backoff, which resets once a worker has renewed its lease.
- `Worker` is exported, and the client gains `getWorker`, `getWorkers`, `listWorkers`, `countWorkersByTypeNames` and `listWorkerJobs`.
- The dashboard adds a Workers list, worker pages and a Workers summary on the Overview, links a running job's worker, and flags job types with pending jobs and no live worker.
