---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/dashboard": major
"@queuert/otel": major
"@queuert/nats": major
"@queuert/redis": major
---

Redesign the job model around the head row: a chain's head row _is_ the chain, and the chain's own facts — type name, status, deduplication key, trace context and completion time — live on that row and are written when the chain ends rather than inferred from its latest job. This is a breaking schema change that replaces the job tables: the database must already be at v0.15.1. On PostgreSQL, `migrateToLatest()` copies the tables while v0.15.1 workers keep running and blocks them only for a final swap of a few seconds; on SQLite, all workers and clients must be stopped while it runs.

- `ChainStatus` drops `"blocked"` and `"pending"`, leaving `"running" | "completed"`; a chain is running until its tail job completes terminally, and only the `completed` variant of `Chain` carries `output` and `completedAt`. Job status is unchanged (`blocked` stays a job status).
- Completed jobs carry `continuedToId`: `null` with `output` when the job ended its chain, the successor's id (and no `output`) when it continued.
- The running `Job` variant replaces the optional `leasedBy` / `leasedUntil` with `attemptAt` (when the current attempt started), `attemptBy` and `attemptUntil`.
- Lease terminology becomes attempt terminology: `leaseConfig` → `attemptConfig` on processors and worker defaults (`leaseMs` → `timeoutMs`, `renewIntervalMs` → `heartbeatMs`); log events `job_attempt_lease_expired` / `job_attempt_lease_renewed` / `job_reaped` → `job_attempt_expired` / `job_attempt_extended` / `job_attempt_reclaimed`; OTEL metrics `queuert.job.attempt.lease_expired` / `queuert.job.attempt.lease_renewed` / `queuert.job.reaped` → `queuert.job.attempt.expired` / `queuert.job.attempt.extended` / `queuert.job.attempt.reclaimed`.
- `listChains`, `listJobs` and `listChainJobs` take flat options with a single `status` string instead of a `filter` object with arrays, and `orderBy` is status-dependent and checked at compile time (e.g. running jobs by `attemptAt` or `attemptUntil`, completed jobs and chains by `completedAt`). `root` is renamed `independent` on `listChains`, `listChainJobs` takes `chainTypeName` instead of `typeName`, its cursors are opaque, and `CreatedAtCursor` is renamed `TimestampWithIdCursor`.
- Deduplication `scope` is now required, and `"incomplete"` is renamed `"running"`.
- The dashboard follows the model: the chain status filter offers only running and completed.
- Concurrent `migrateToLatest()` calls are safe across processes: PostgreSQL serializes them through a new single-row `{tablePrefix}migration_lock` table (SQLite relies on its single writer).
- The migration history collapses to a single `001_initial_schema` migration that fresh installs and upgrades run alike; the 0.15.x records are removed from `{tablePrefix}migration`, and on PostgreSQL the `{tablePrefix}job_status` enum is dropped.
- Schema: `status` becomes `text` under a CHECK constraint; `chain_status`, `chain_completed_at`, `continued_to_id` and `attempt_at` are added; `chain_type_name` is removed (a chain's type is its head job's `type_name`); `deduplication_key` → `chain_deduplication_key`; `leased_by` / `leased_until` → `attempt_by` / `attempt_until`; the foreign keys from job rows and blocker rows to jobs are dropped; a CHECK constraint keeps the `chain_*` columns set only on head rows; columns are reordered to avoid alignment padding.
- Indexes go from 10 to 11: `job_blocker_chain_idx` is unchanged, `chain_index_idx` becomes partial (`WHERE chain_index > 0`), `job_deduplication_idx` becomes `chain_deduplication_idx`, and the seven acquisition-, lease- and listing-oriented indexes are replaced by one partial index per status (`job_pending_idx`, `job_blocked_idx`, `job_running_idx`, `job_completed_idx`, `chain_running_idx`, `chain_completed_idx`) plus `chain_idx` and `job_idx`.
