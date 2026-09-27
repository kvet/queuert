---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/dashboard": major
"@queuert/otel": major
"@queuert/nats": major
"@queuert/redis": major
---

Redesign the job model around the head row: a chain's head row _is_ the chain, and the chain's own facts — type name, status, deduplication key, trace context and completion time — live on that row and are written when the chain ends rather than inferred from its latest job. **This is a breaking schema change that replaces the job tables rather than altering them, and it is not a rolling deploy. Your database must already be at v0.15.1 (`migrateToLatest()` refuses an older schema). Back up your database, stop all workers, then run `migrateToLatest()`; job processing is unavailable while the upgrade runs and old-version workers fail against the new schema.** The upgrade renames the live tables aside to `{tablePrefix}job_old` / `{tablePrefix}job_blocker_old`, installs the new schema, imports the rows a chain at a time, and drops the old tables once every old row is present in the new ones; an interrupted run resumes where it stopped. On PostgreSQL the rename step gives up after 5 seconds with an error telling you to stop all workers if anything still holds the job tables.

- `ChainStatus` drops `"blocked"` and `"pending"`, leaving `"running" | "completed"`; a chain is running until its last job completes terminally, and only the `completed` variant of `Chain` carries `output` and `completedAt`. Job status is unchanged (`blocked` stays a job status).
- Completed jobs carry `continuedToId`: `null` with `output` when the job ended its chain, the successor's id (and no `output`) when it continued.
- The running `Job` variant replaces the optional `leasedBy` / `leasedUntil` with `attemptAt` (when the current attempt started), `attemptBy` and `attemptUntil`.
- Lease terminology becomes attempt terminology: `leaseConfig` → `attemptConfig` on processors and worker defaults (`leaseMs` → `timeoutMs`, `renewIntervalMs` → `heartbeatMs`); log events `job_attempt_lease_expired` / `job_attempt_lease_renewed` / `job_reaped` → `job_attempt_expired` / `job_attempt_extended` / `job_attempt_reclaimed`; OTEL metrics `queuert.job.attempt.lease_expired` / `queuert.job.attempt.lease_renewed` / `queuert.job.reaped` → `queuert.job.attempt.expired` / `queuert.job.attempt.extended` / `queuert.job.attempt.reclaimed`.
- `listChains`, `listJobs` and `listChainJobs` take flat options with a single `status` string instead of a `filter` object with arrays, and `orderBy` is status-dependent and checked at compile time (e.g. running jobs by `attemptAt` or `attemptUntil`, completed jobs and chains by `completedAt`). `root` is renamed `independent` on `listChains`, `listChainJobs` takes `chainTypeName` instead of `typeName`, its cursors are opaque, and `CreatedAtCursor` is renamed `TimestampWithIdCursor`.
- Deduplication `scope` is now required, and `"incomplete"` is renamed `"running"`.
- The dashboard follows the model: the chain status filter offers only running and completed and the job types view counts blocked jobs in their own column.
- Concurrent `migrateToLatest()` calls are safe across processes: PostgreSQL serializes them through a new single-row `{tablePrefix}migration_lock` table (SQLite relies on its single writer).
- The migration history collapses to a single `001_initial_schema` migration that fresh installs and upgrades run alike; the 0.15.x records are removed from `{tablePrefix}migration`, and on PostgreSQL the `{tablePrefix}job_status` enum is dropped.
- Schema: `status` becomes `text` under a CHECK constraint; `chain_status`, `chain_completed_at`, `continued_to_id` and `attempt_at` are added; `chain_type_name` is removed (a chain's type is its head job's `type_name`); `deduplication_key` → `chain_deduplication_key`; `leased_by` / `leased_until` → `attempt_by` / `attempt_until`; the foreign keys from job rows and blocker rows to jobs are dropped; columns are reordered to avoid alignment padding.
- Indexes go from 10 to 11: `job_blocker_chain_idx` is unchanged, `chain_index_idx` becomes partial (`WHERE chain_index > 0`), `job_deduplication_idx` becomes `chain_deduplication_idx`, and the seven acquisition-, lease- and listing-oriented indexes are replaced by one partial index per status (`job_pending_idx`, `job_blocked_idx`, `job_running_idx`, `job_completed_idx`, `chain_running_idx`, `chain_completed_idx`) plus `chain_idx` and `job_idx`.
