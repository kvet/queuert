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

| Column                    | Type                           | Description                                                         |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `id`                      | configurable (default: `uuid`) | Job identifier                                                      |
| `type_name`               | `text`                         | Job type identifier                                                 |
| `chain_id`                | same as `id`                   | The head job's id — every job in a chain points to the head         |
| `chain_index`             | `integer`                      | Position in chain (0 for the head, incrementing for continuations)  |
| `continued_to_id`         | same as `id`                   | The next job's id in the chain                                      |
| `input`                   | `jsonb`                        | Job input data                                                      |
| `output`                  | `jsonb`                        | Completion output (null until completed)                            |
| `status`                  | `text`                         | `blocked`, `pending`, `running` or `completed` (CHECK-constrained)  |
| `created_at`              | `timestamptz`                  | When the job was created                                            |
| `scheduled_at`            | `timestamptz`                  | Earliest time the job can be acquired                               |
| `completed_at`            | `timestamptz`                  | When the job completed (null until completed)                       |
| `completed_by`            | `text`                         | Worker ID that completed the job (null for workerless)              |
| `attempt`                 | `integer`                      | Number of processing attempts (starts at 0)                         |
| `last_attempt_at`         | `timestamptz`                  | When the last failed attempt ended                                  |
| `last_attempt_error`      | `jsonb`                        | Error from the last failed or reclaimed attempt                     |
| `attempt_at`              | `timestamptz`                  | When the current attempt started (null when idle)                   |
| `attempt_by`              | `text`                         | ID of the worker holding the current attempt                        |
| `trace_context`           | `text`                         | W3C traceparent for this job                                        |
| `chain_status`            | `text`                         | **Head rows only.** `running` or `completed` (CHECK-constrained)    |
| `chain_completed_at`      | `timestamptz`                  | **Head rows only.** When the chain completed (null until completed) |
| `chain_deduplication_key` | `text`                         | **Head rows only.** Key for chain deduplication                     |
| `chain_trace_context`     | `text`                         | **Head rows only.** W3C traceparent for the chain                   |

Primary key: `id`. The adapter writes the `chain_*` columns only on head rows (`chain_index = 0`); continuation rows leave them null.

Columns are declared `timestamptz → integer → id → text/jsonb` so the fixed-width values sit together and stop paying alignment padding around the `jsonb` payloads.

### Job Blocker Table

The `job_blocker` table tracks dependencies between jobs and chains:

| Column                | Type         | Description                      |
| --------------------- | ------------ | -------------------------------- |
| `job_id`              | same as `id` | The blocked job                  |
| `blocked_by_chain_id` | same as `id` | Head job ID of the blocker chain |
| `index`               | `integer`    | Position in the blockers array   |
| `trace_context`       | `text`       | W3C traceparent                  |

Primary key: `(job_id, blocked_by_chain_id, index)` — each blocker slot is unique.

### Worker Table

The `worker` table holds one row per worker, each with a lease:

| Column        | Type          | Description                                                 |
| ------------- | ------------- | ----------------------------------------------------------- |
| `started_at`  | `timestamptz` | When the worker started                                     |
| `lease_until` | `timestamptz` | Lease expiry — the worker is live while it is in the future |
| `concurrency` | `integer`     | Most attempts the worker runs at once                       |
| `id`          | `text`        | Worker ID, from the state adapter's `generateWorkerId`      |
| `name`        | `text`        | The in-process worker's `workerName`                        |
| `type_names`  | `text[]`      | Job types the worker processes                              |

Primary key: `id`. A row is inserted by `startWorker`, its `lease_until` moved by `extendWorkerLease`, and it is deleted by `stopWorker` or by the reclaim that finds its lease expired. There is no foreign key from `job.attempt_by` to `worker.id`: a `running` job whose worker row is gone is reclaimed. The table has no index besides its primary key: it holds one row per live worker plus rows not reclaimed yet, so `listWorkers` scans it and `countWorkersByTypeNames` filters it with `= ANY(type_names)`.

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

## Indexes

### Job Table

| Index                     | Definition                                                                                                 | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `chain_deduplication_idx` | `(chain_deduplication_key, created_at DESC) WHERE chain_deduplication_key IS NOT NULL AND chain_index = 0` | Deduplication lookup                                             |
| `chain_index_idx`         | `UNIQUE (chain_id, chain_index) WHERE chain_index > 0`                                                     | Chain position uniqueness                                        |
| `job_idx`                 | `(type_name, created_at)`                                                                                  | All jobs by type and time                                        |
| `job_pending_idx`         | `(type_name, scheduled_at) WHERE status = 'pending'`                                                       | Job acquisition and pending job listing                          |
| `job_blocked_idx`         | `(type_name, scheduled_at) WHERE status = 'blocked'`                                                       | Blocked job listing                                              |
| `job_running_idx`         | `(type_name, attempt_at) WHERE status = 'running'`                                                         | Running job listing                                              |
| `job_attempt_by_idx`      | `(attempt_by) WHERE status = 'running'`                                                                    | Reclaim, `stopWorker`, worker job listing and running job counts |
| `job_completed_idx`       | `(type_name, completed_at) WHERE status = 'completed'`                                                     | Completed job listing                                            |
| `chain_idx`               | `(type_name, created_at) WHERE chain_index = 0`                                                            | Chains by type and time                                          |
| `chain_running_idx`       | `(type_name, created_at) WHERE chain_index = 0 AND chain_status = 'running'`                               | Running chain listing                                            |
| `chain_completed_idx`     | `(type_name, chain_completed_at) WHERE chain_index = 0 AND chain_status = 'completed'`                     | Completed chain listing                                          |

### Job Blocker Table

| Index                   | Definition              | Purpose            |
| ----------------------- | ----------------------- | ------------------ |
| `job_blocker_chain_idx` | `(blocked_by_chain_id)` | Blocker resolution |

## Isolation Level

Queuert supports only READ COMMITTED, PostgreSQL's default isolation level. This covers every transaction Queuert writes in, including the ones you pass to `complete` and to client methods. Its conditional and multi-statement writes — such as `unblockJobs` locking the blocked jobs and then recomputing their blockers — rely on each statement taking a fresh snapshot after it waits on a row lock.

## Notifications (LISTEN/NOTIFY)

The adapter uses three notification channels (configurable prefix, default `queuert`):

| Channel           | Published When       | Payload       | Purpose                             |
| ----------------- | -------------------- | ------------- | ----------------------------------- |
| `{prefix}_sched`  | Jobs become pending  | Job type name | Wake idle workers                   |
| `{prefix}_chainc` | Chain completes      | Chain ID      | Wake clients awaiting chain results |
| `{prefix}_atls`   | Attempt is reclaimed | Job ID        | Notify workers of attempt loss      |

Each notify method hands its whole batch to `PgNotifyProvider.publish` in one call, and the example providers publish it in one statement (`SELECT pg_notify($1, message) FROM unnest($2::text[]) AS message` in `notify-postgres-pg`, `json_array_elements_text` in the postgres-js and Bun.SQL examples), so a commit costs one round-trip per channel. PostgreSQL delivers identical channel and payload pairs once per transaction, so the items in a batch are expected to be unique.

All listening workers query the database on each job-scheduled notification. `FOR UPDATE SKIP LOCKED` ensures only one worker acquires each job, so the redundant queries are cheap, not harmful.

## Vacuum Tuning

The schema configures aggressive autovacuum and storage settings on the job tables:

- **`fillfactor = 75`** on `job` reserves free space per heap page for HOT updates. `job_blocker` skips it — blockers are inserted and deleted without intermediate updates.
- **`fillfactor = 50`** on `worker` leaves room for each lease renewal to be a HOT update on the same page.
- **`autovacuum_vacuum_threshold` / `autovacuum_analyze_threshold = 5000`** with **`scale_factor = 0`** on both tables pin autovacuum to a fixed dead-tuple budget, and **`autovacuum_vacuum_cost_delay = 0`** removes I/O throttling.

## See Also

- [Adapter Architecture](../adapters/) — Provider/adapter design philosophy
- [PostgreSQL Reference](/queuert/api/postgres/readme/) — API documentation
