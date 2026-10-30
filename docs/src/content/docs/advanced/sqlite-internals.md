---
title: SQLite Internals
description: Schema, indexes, and concurrency in the SQLite adapter.
sidebar:
  order: 8
---

## Overview

This document describes the internal implementation of `@queuert/sqlite` — the tables it creates, how it handles concurrency within SQLite's single-writer model, and where its design differs from other adapters.

## Schema

The adapter creates its schema via `migrateToLatest()`. All table names use a configurable prefix (default: `queuert_`).

### Migration Table

The `{tablePrefix}migration` table tracks applied schema migrations:

| Column       | Type   | Description                                         |
| ------------ | ------ | --------------------------------------------------- |
| `name`       | `TEXT` | Migration identifier (e.g., `001_initial_schema`)   |
| `applied_at` | `TEXT` | ISO 8601 timestamp — when the migration was applied |

### Job Table

The `{tablePrefix}job` table stores all job state:

| Column                    | Type                           | Description                                                        |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| `id`                      | configurable (default: `text`) | Job identifier                                                     |
| `type_name`               | `TEXT`                         | Job type identifier — on a head row, also the chain's type         |
| `chain_id`                | same as `id`                   | The chain's head job id                                            |
| `chain_index`             | `INTEGER`                      | Position in chain (0 for the head)                                 |
| `continued_to_id`         | same as `id`                   | The next job's id in the chain                                     |
| `input`                   | `TEXT`                         | Job input as JSON string                                           |
| `output`                  | `TEXT`                         | Completion output as JSON string                                   |
| `status`                  | `TEXT`                         | `blocked`, `pending`, `running` or `completed` (CHECK-constrained) |
| `created_at`              | `TEXT`                         | ISO 8601 timestamp                                                 |
| `scheduled_at`            | `TEXT`                         | ISO 8601 timestamp                                                 |
| `completed_at`            | `TEXT`                         | ISO 8601 timestamp                                                 |
| `completed_by`            | `TEXT`                         | Worker ID                                                          |
| `attempt`                 | `INTEGER`                      | Attempt count                                                      |
| `last_attempt_at`         | `TEXT`                         | ISO 8601 timestamp                                                 |
| `last_attempt_error`      | `TEXT`                         | Error as JSON string                                               |
| `attempt_at`              | `TEXT`                         | ISO 8601 timestamp — set when a worker starts an attempt           |
| `attempt_by`              | `TEXT`                         | ID of the worker holding the attempt                               |
| `trace_context`           | `TEXT`                         | W3C traceparent                                                    |
| `chain_status`            | `TEXT`                         | **Head rows only.** `running` or `completed` (CHECK-constrained).  |
| `chain_completed_at`      | `TEXT`                         | **Head rows only.** ISO 8601 timestamp — the chain's completion.   |
| `chain_deduplication_key` | `TEXT`                         | **Head rows only.** Deduplication key.                             |
| `chain_trace_context`     | `TEXT`                         | **Head rows only.** W3C traceparent for the chain.                 |

Primary key: `id`.

The adapter writes the `chain_*` columns only on head rows (`chain_index = 0`); continuation rows leave them NULL.

### Job Blocker Table

| Column                | Type         | Description                      |
| --------------------- | ------------ | -------------------------------- |
| `job_id`              | same as `id` | The blocked job                  |
| `blocked_by_chain_id` | same as `id` | Head job ID of the blocker chain |
| `index`               | `INTEGER`    | Position in blockers array       |
| `trace_context`       | `TEXT`       | W3C traceparent                  |

Primary key: `(job_id, blocked_by_chain_id, index)`.

### Worker Table

The `{tablePrefix}worker` table holds one row per worker, each with a lease:

| Column        | Type      | Description                                                       |
| ------------- | --------- | ----------------------------------------------------------------- |
| `started_at`  | `TEXT`    | ISO 8601 timestamp — when the worker started                      |
| `lease_until` | `TEXT`    | ISO 8601 timestamp — the worker is live while it is in the future |
| `concurrency` | `INTEGER` | Most attempts the worker runs at once                             |
| `id`          | `TEXT`    | Worker ID, from the state adapter's `generateWorkerId`            |
| `name`        | `TEXT`    | The in-process worker's `workerName`                              |
| `type_names`  | `TEXT`    | JSON array of the job types the worker processes                  |

Primary key: `id`. A row is inserted by `startWorker`, its `lease_until` moved by `extendWorkerLease`, and it is deleted by `stopWorker` or by the reclaim that finds its lease expired. There is no foreign key from `job.attempt_by` to `worker.id`: a `running` job whose worker row is gone is reclaimed. The table has no index besides its primary key: `listWorkers` and `countWorkersByTypeNames` scan it and filter `type_names` with `json_each`.

## Indexes

### Job Table

| Index                     | Definition                                                                                                 | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `chain_deduplication_idx` | `(chain_deduplication_key, created_at DESC) WHERE chain_deduplication_key IS NOT NULL AND chain_index = 0` | Deduplication lookup                                             |
| `chain_index_idx`         | `UNIQUE (chain_id, chain_index) WHERE chain_index > 0`                                                     | Continuation position uniqueness                                 |
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

## AsyncRwLock

The adapter adds an application-level `AsyncRwLock` to prevent concurrent write access from async code within the same process while allowing reads to run in parallel. The lock is writer-preference and FIFO to prevent writer starvation: once a writer is queued, new readers wait.

- **Outside a transaction**: Every SQL execution acquires the lock in the mode indicated by `readOnly`
- **Inside a transaction**: The write lock was already acquired by whoever opened the transaction — `withTransaction`, or your own code (see below) — so individual operations skip it

Custom `SqliteStateProvider` implementations must use `createAsyncRwLock()` to ensure correct serialization.

## Notifications

SQLite has no built-in pub/sub mechanism. The adapter uses the in-process notify adapter (`createInProcessNotifyAdapter`), which provides synchronous event delivery within a single process. This means SQLite deployments are limited to single-process operation for notification delivery.

For multi-process deployments, an external notify adapter (Redis or NATS) can be paired with the SQLite state adapter.

## See Also

- [Adapter Architecture](../adapters/) — Provider/adapter design philosophy
- [SQLite Reference](/queuert/api/sqlite/readme/) — API documentation
