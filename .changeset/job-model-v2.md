---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/dashboard": major
"@queuert/otel": major
"@queuert/nats": major
"@queuert/redis": major
---

Redesign the job model: replace `blocked` status with a denormalized `blocked: boolean` attribute on the `pending` variant, surface `continuedToId` on completed jobs, add `attemptAt` to the attempt triplet, merge `completeJob`/`abandonJob` into `finishJobAttempt`, fold lease terminology into the attempt concept, and redesign listing APIs with status-dependent ordering.

**This is a breaking schema migration. Back up your database before upgrading, and run `migrateToLatest()` before starting workers — a normal rolling deploy; stopping all workers first is not required.** Backfills run in batches on Postgres and are idempotent and safe to restart if interrupted.

- **Status model** — `blocked` is no longer a job or chain status. A blocked job is `status: "pending"` with `blocked: true`, backed by a new `blocked` column. `JobStatus` drops `"blocked"`; `ChainStatus` drops both `"blocked"` and `"pending"`, leaving `"running" | "completed"`. Blocked jobs can now be rescheduled (`rescheduleJob` no longer throws `JobNotReschedulableError` for them).
- **Chain navigation** — completed jobs now carry `continuedToId` (terminal variant: `continuedToId: null` with `output`; continued variant: `continuedToId: TJobId`, no `output`). `chainIndex` is dropped from both the public `Job` type and the `StateJob` surface. `createJobs` splits into `createChains` and `createContinuationJob`. `listChainJobs` cursors are now opaque id strings.
- **Attempt lifecycle** — `attemptAt` records when the current attempt started. Column renames: `leased_at` → `attempt_at`, `leased_by` → `attempt_by`, `leased_until` → `attempt_until`. Method renames: `acquireJob` → `startJobAttempt`, `releaseJob` → `finishJobAttempt`, `renewJobLease` → `extendJobAttempt`, `reapExpiredJobLease` → `reclaimExpiredJobAttempt`, `getNextJobAvailableInMs` → `getStartAttemptDelayMs`. `LeaseConfig` → `AttemptConfig` (`leaseMs` → `timeoutMs`, `renewIntervalMs` → `heartbeatMs`), `leaseConfig` → `attemptConfig` on processors and worker defaults. Log events: `job_attempt_lease_expired` → `job_attempt_expired`, `job_attempt_lease_renewed` → `job_attempt_extended`, `job_reaped` → `job_attempt_reclaimed`. OTEL metrics: `queuert.job.attempt.lease_expired` → `queuert.job.attempt.expired`, `queuert.job.attempt.lease_renewed` → `queuert.job.attempt.extended`, `queuert.job.reaped` → `queuert.job.attempt.reclaimed`.
- **Migration locking** — concurrent `migrateToLatest()` calls are now safe across processes: the Postgres adapter serializes them via a new single-row `{tablePrefix}migration_lock` lease table, so every pod in a rolling deploy can run migrations (SQLite relies on its single-writer serialization).
- **Listing APIs** — `listChains`, `listJobs`, and `listChainJobs` use flat options with a discriminated union on `status` (single string, not array). `orderBy` is status-dependent and compile-time validated. `root` → `independent`, `typeName` → `chainTypeName` on `listChainJobs`, `jobId` dropped from `listChains`. `CreatedAtCursor` renamed to `TimestampWithIdCursor`.
- **Index consolidation** — indexes reorganized from 10 to 12. Dropped: `job_acquisition_idx`, `job_expired_lease_idx`, `job_listing_status_idx`, `job_listing_type_name_idx`, `chain_listing_type_name_idx`, `chain_listing_idx`, `job_listing_idx`, `job_deduplication_idx`. Added: `job_ready_idx`, `job_pending_idx`, `job_running_idx`, `job_completed_idx`, `job_continuation_idx`, `chain_tail_open_idx`, `chain_tail_completed_idx`, `chain_head_idx`, `job_idx`, `chain_deduplication_idx`. Surviving: `chain_index_idx`, `job_blocker_chain_idx`.
- **Deduplication** — `scope` is now required (no implicit default). `scope: "incomplete"` renamed to `scope: "running"` (`"incomplete"` is no longer accepted).
- **Dashboard** — blocked jobs render as `pending (blocked)`. Filter bar includes status-dependent order-by and sort direction. `listJobs` gains `blocked?: boolean` filter.
