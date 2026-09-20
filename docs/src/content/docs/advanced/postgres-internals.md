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
| `last_attempt_at`         | `timestamptz`                  | When the last attempt started                                       |
| `last_attempt_error`      | `jsonb`                        | Error from last failed attempt                                      |
| `attempt_at`              | `timestamptz`                  | When the current attempt started (null when idle)                   |
| `attempt_by`              | `text`                         | Worker ID holding the current attempt                               |
| `attempt_until`           | `timestamptz`                  | Attempt expiry time                                                 |
| `trace_context`           | `text`                         | W3C traceparent for this job                                        |
| `chain_status`            | `text`                         | **Head rows only.** `running` or `completed` (CHECK-constrained)    |
| `chain_completed_at`      | `timestamptz`                  | **Head rows only.** When the chain completed (null until completed) |
| `chain_deduplication_key` | `text`                         | **Head rows only.** Key for chain deduplication                     |
| `chain_trace_context`     | `text`                         | **Head rows only.** W3C traceparent for the chain                   |

Primary key: `id`.

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

All indexes use partial conditions (WHERE clauses) to minimize size and target specific query patterns.

### Job Table

| Index                     | Definition                                                                                                 | Purpose                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `chain_deduplication_idx` | `(chain_deduplication_key, created_at DESC) WHERE chain_deduplication_key IS NOT NULL AND chain_index = 0` | Deduplication lookup                        |
| `chain_index_idx`         | `UNIQUE (chain_id, chain_index) WHERE chain_index > 0`                                                     | Chain position uniqueness                   |
| `job_idx`                 | `(type_name, created_at)`                                                                                  | All jobs by type and time                   |
| `job_pending_idx`         | `(type_name, scheduled_at) WHERE status = 'pending'`                                                       | Job acquisition and pending job listing     |
| `job_blocked_idx`         | `(type_name, scheduled_at) WHERE status = 'blocked'`                                                       | Blocked job listing                         |
| `job_running_idx`         | `(type_name, attempt_until) WHERE status = 'running'`                                                      | Attempt reclamation and running job listing |
| `job_completed_idx`       | `(type_name, completed_at) WHERE status = 'completed'`                                                     | Completed job listing                       |
| `chain_idx`               | `(type_name, created_at) WHERE chain_index = 0`                                                            | Chains by type and time                     |
| `chain_running_idx`       | `(type_name, created_at) WHERE chain_index = 0 AND chain_status = 'running'`                               | Running chain listing                       |
| `chain_completed_idx`     | `(type_name, chain_completed_at) WHERE chain_index = 0 AND chain_status = 'completed'`                     | Completed chain listing                     |

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

## See Also

- [Adapter Architecture](../adapters/) — Provider/adapter design philosophy
- [PostgreSQL Reference](/queuert/api/postgres/readme/) — API documentation
