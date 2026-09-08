---
title: PostgreSQL Internals
description: Schema, indexes, locking, and notification design in the PostgreSQL adapter
sidebar:
  order: 7
---

## Overview

This document describes the internal implementation of `@queuert/postgres` — the tables it creates, how it uses PostgreSQL-specific features for correctness and performance, and how notifications propagate between workers.

## Schema

The adapter creates its schema via `migrateToLatest()`. All objects live under a configurable PostgreSQL schema (default: `public`) with a table name prefix (default: `queuert_`) for namespace isolation.

### Job Table

The `job` table stores all job state:

// TODO!!!: WTF is 'same as id'???

| Column                | Type                           | Description                                                                                                                                               |
| --------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | configurable (default: `uuid`) | Primary key. Type is set via `idType`; values are generated in JS via `generateId`                                                                        |
| `type_name`           | `text`                         | Job type identifier                                                                                                                                       |
| `chain_id`            | same as `id`                   | The head job's id — every job in a chain points to the head. No foreign key (see [Dropped foreign keys](#dropped-foreign-keys))                           |
| `chain_index`         | `integer`                      | Position in chain (0 for the head, incrementing for continuations)                                                                                        |
| `continued_to_id`     | same as `id`                   | The next job in the chain — non-null exactly when this job has a successor (set transactionally when `continueWith` inserts the next row). No foreign key |
| `input`               | `jsonb`                        | Job input data                                                                                                                                            |
| `output`              | `jsonb`                        | Completion output (null until completed)                                                                                                                  |
| `blocked`             | `boolean`                      | Whether the job is waiting on blockers. Blocked jobs are logically pending but excluded from acquisition                                                  |
| `created_at`          | `timestamptz`                  | When the job was created                                                                                                                                  |
| `scheduled_at`        | `timestamptz`                  | Earliest time the job can be acquired                                                                                                                     |
| `completed_at`        | `timestamptz`                  | When the job completed (null until completed)                                                                                                             |
| `completed_by`        | `text`                         | Worker ID that completed the job (null for workerless)                                                                                                    |
| `attempt`             | `integer`                      | Number of processing attempts (starts at 0)                                                                                                               |
| `last_attempt_at`     | `timestamptz`                  | When the last attempt started                                                                                                                             |
| `last_attempt_error`  | `jsonb`                        | Error from last failed attempt                                                                                                                            |
| `attempt_at`          | `timestamptz`                  | When the current attempt started (null when idle)                                                                                                         |
| `attempt_by`          | `text`                         | Worker ID holding the current attempt                                                                                                                     |
| `attempt_until`       | `timestamptz`                  | Attempt expiry time                                                                                                                                       |
| `chain_completed_at`  | `timestamptz`                  | **Head rows only.** When the chain completed (null while running). Set on the head when the job that ends the chain completes                             |
| `deduplication_key`   | `text`                         | **Head rows only.** Key for chain deduplication                                                                                                           |
| `chain_trace_context` | `text`                         | **Head rows only.** W3C traceparent for the chain                                                                                                         |
| `trace_context`       | `text`                         | W3C traceparent for this job                                                                                                                              |

The head row is the chain: its `type_name` is the chain's type, its `created_at` the chain's creation, and `chain_completed_at` the chain's completion. Continuation rows carry none of the chain columns, so no chain fact is stored twice.

Columns are declared `timestamptz → integer → boolean → id → text/jsonb` so the fixed-width values sit together and stop paying alignment padding around the `jsonb` payloads.

// TODO!!!: WTF this section? We show the current state in the docs and not historic ruminations of llm

### Dropped foreign keys

Neither `chain_id` nor `continued_to_id` has a foreign key, and neither does `job_blocker.blocked_by_chain_id`. A referential-integrity check takes a `KEY SHARE` lock on the parent row, and RI checks have no `SKIP LOCKED`. For `blocked_by_chain_id` that lock points cross-transaction at another chain's head row — the row job acquisition holds `FOR UPDATE` — so an insert would wait for the length of a job handler. `addJobsBlockers` performs that existence check itself and throws `ChainNotFoundError`, which rolls the transaction back exactly as the constraint did. `job_blocker.job_id` keeps its foreign key: its parent is always a row the same transaction just inserted, so its `KEY SHARE` never conflicts.

That wait is reduced rather than abolished. `addJobsBlockers` still takes `FOR UPDATE` on the blocker chain's head, and a locked read of a job now covers that head too, so registering a blocker on a chain that is inside a `step` or `complete` window waits for that window. What is gone is the wait for a whole handler: the head is locked just before completion rather than for the length of the attempt.

### Job Blocker Table

The `job_blocker` table tracks dependencies between jobs and chains:

| Column                | Type                     | Description                                                                                          |
| --------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `job_id`              | foreign key to `job(id)` | The blocked job                                                                                      |
| `blocked_by_chain_id` | same as `id`             | Head job ID of the blocker chain. No foreign key (see [Dropped foreign keys](#dropped-foreign-keys)) |
| `index`               | `integer`                | Position in the blockers array                                                                       |
| `trace_context`       | `text`                   | W3C traceparent                                                                                      |

Primary key: `(job_id, blocked_by_chain_id, index)` — each blocker slot is unique.

### Migration Table

The `migration` table tracks applied schema migrations:

| Column       | Type          | Description                                       |
| ------------ | ------------- | ------------------------------------------------- |
| `name`       | `text`        | Migration identifier (e.g., `001_initial_schema`) |
| `applied_at` | `timestamptz` | When the migration was applied                    |

### Migration Lock Table

The `migration_lock` table holds a single-row lease that gives `migrateToLatest()` cross-process mutual exclusion:

| Column         | Type          | Description                           |
| -------------- | ------------- | ------------------------------------- |
| `id`           | `integer`     | Always `1` (single-row constraint)    |
| `locked_by`    | `text`        | Owner id of the current migration run |
| `locked_until` | `timestamptz` | Lease expiry (heartbeat-extended)     |

Before reading the applied set, `migrateToLatest()` claims the lease (stealing it only when expired), heartbeats it every 20s with a 60s TTL while migrations run, and releases it afterwards. Waiting processes poll every second, then re-read the applied set — so a pod that lost the race sees the winner's work and skips, which makes `migrateToLatest()` safe to run from every pod in a rolling deploy. A crashed migrator blocks others only until its lease expires. The lease uses plain autocommit statements, so it works with any state provider — no pinned connection or session state required. The 0.15.x upgrade is the exception to the rolling-deploy part: see [Upgrading from 0.15.x](#upgrading-from-015x).

### Upgrading from 0.15.x

The 0.15.x schema is not migrated in place. `migrateToLatest()` renames the live `{tablePrefix}job`
and `{tablePrefix}job_blocker` aside to `{tablePrefix}job_old` and `{tablePrefix}job_blocker_old`,
installs the current schema from scratch — exactly the statements a fresh install runs — imports the
rows into it a chain at a time, and drops the renamed tables once the row counts match. The
`{tablePrefix}job_status` enum is dropped with them, as are the 0.15.x migration records.

- **The database must already be at v0.15.1.** `migrateToLatest()` refuses an older schema with an
  error naming the migration it expected. Upgrade to 0.15.1 and run `migrateToLatest()` first.
- **Stop your workers first.** Unlike the incremental migrations before it, this is not a rolling
  deploy: job processing is unavailable while it runs, and old-version workers fail against the new
  schema. Back up the database before starting.
- **An interrupted upgrade resumes.** Chains are imported whole and in id order, so a re-run picks up
  from the last imported chain. The renamed tables are only dropped after the imported row counts are
  verified against them.

## Indexes

All indexes use partial conditions (WHERE clauses) to minimize size and target specific query patterns.

### Job Table

| Index                   | Definition                                                                                        | Purpose                   |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ------------------------- |
| `job_deduplication_idx` | `(deduplication_key, created_at DESC) WHERE deduplication_key IS NOT NULL AND chain_index = 0`    | Deduplication lookup      |
| `chain_index_idx`       | `UNIQUE (chain_id, chain_index) WHERE chain_index > 0`                                            | Chain position uniqueness |
| `job_idx`               | `(type_name, created_at)`                                                                         | All jobs by type and time |
| `job_pending_idx`       | `(type_name, scheduled_at) WHERE attempt_at IS NULL AND completed_at IS NULL`                     | Pending job listing       |
| `job_ready_idx`         | `(type_name, scheduled_at) WHERE blocked = false AND attempt_at IS NULL AND completed_at IS NULL` | Job acquisition           |
| `job_running_idx`       | `(type_name, attempt_until) WHERE attempt_at IS NOT NULL AND completed_at IS NULL`                | Attempt reclamation       |
| `job_completed_idx`     | `(type_name, completed_at) WHERE completed_at IS NOT NULL`                                        | Completed job listing     |
| `chain_idx`             | `(type_name, created_at) WHERE chain_index = 0`                                                   | Chains by type and time   |
| `chain_running_idx`     | `(type_name, created_at) WHERE chain_index = 0 AND chain_completed_at IS NULL`                    | Running chain listing     |
| `chain_completed_idx`   | `(type_name, chain_completed_at) WHERE chain_index = 0 AND chain_completed_at IS NOT NULL`        | Completed chain listing   |

### Job Blocker Table

| Index                   | Definition              | Purpose            |
| ----------------------- | ----------------------- | ------------------ |
| `job_blocker_chain_idx` | `(blocked_by_chain_id)` | Blocker resolution |

## Row Locking

Beyond the `FOR UPDATE SKIP LOCKED` used for job acquisition, a client read passed `lock: true` (`getChain`, `getChains`, `getJob`, `getJobs`) issues a plain `SELECT ... FOR UPDATE` on the matched rows. The write-intent lock is held until the enclosing transaction commits or rolls back, so a read-modify-write against those rows is race-free. Rows that do not exist lock nothing. See [Locked reads](/queuert/guides/queries/#locked-reads).

## Notifications (LISTEN/NOTIFY)

The adapter uses three notification channels (configurable prefix, default `queuert`):

| Channel           | Published When                      | Payload       | Purpose                             |
| ----------------- | ----------------------------------- | ------------- | ----------------------------------- |
| `{prefix}_sched`  | Jobs become pending                 | Job type name | Wake idle workers                   |
| `{prefix}_chainc` | Chain completes                     | Chain ID      | Wake clients awaiting chain results |
| `{prefix}_atls`   | Attempt expires and job is released | Job ID        | Notify workers of attempt loss      |

Unlike Redis and NATS, the PostgreSQL notify adapter does not implement hint-based thundering herd optimization. All listening workers query the database on each notification. This is acceptable because `FOR UPDATE SKIP LOCKED` ensures only one worker acquires each job — redundant queries are cheap, not harmful.

## Vacuum Tuning

The migrations configure aggressive autovacuum and storage settings on the job tables:

- **`fillfactor = 75`** on `job` reserves free space per heap page for HOT updates. `job_blocker` skips it — blockers are inserted and deleted without intermediate updates.
- **`autovacuum_vacuum_threshold` / `autovacuum_analyze_threshold = 5000`** with **`scale_factor = 0`** on both tables pin autovacuum to a fixed dead-tuple budget, and **`autovacuum_vacuum_cost_delay = 0`** removes I/O throttling.

The adapter exposes a `vacuum()` method that runs non-blocking `VACUUM` on both job tables — useful after large batch deletions in the cleanup job.

## See Also

- [Adapter Architecture](../adapters/) — Provider/adapter design philosophy
- [PostgreSQL Reference](/queuert/api/postgres/readme/) — API documentation
