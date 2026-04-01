---
title: PostgreSQL Internals
description: Schema, indexes, locking, and notification design in the PostgreSQL adapter.
sidebar:
  order: 7
---

## Overview

This document describes the internal implementation of `@queuert/postgres` — the tables it creates, how it uses PostgreSQL-specific features for correctness and performance, and how notifications propagate between workers.

## Schema

The adapter creates its schema via `migrateToLatest()`. All objects live under a configurable PostgreSQL schema (default: `public`) with a table name prefix (default: `queuert_`) for namespace isolation.

### Custom Enum

```sql
CREATE TYPE job_status AS ENUM ('blocked', 'pending', 'running', 'completed');
```

PostgreSQL enums provide type safety at the database level — invalid status values are rejected by the engine rather than relying on application-level checks.

### Job Table

The `job` table stores all job state:

| Column                | Type                           | Description                                                                 |
| --------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `id`                  | configurable (default: `uuid`) | Primary key. Type and default expression are set via `idType` / `idDefault` |
| `type_name`           | `text`                         | Job type identifier                                                         |
| `chain_id`            | same as `id`                   | Foreign key to root job — every job in a chain points to the root           |
| `chain_type_name`     | `text`                         | Type name of the chain (copied from root for query efficiency)              |
| `chain_index`         | `integer`                      | Position in chain (0 for root, incrementing for continuations)              |
| `input`               | `jsonb`                        | Job input data                                                              |
| `output`              | `jsonb`                        | Completion output (null until completed)                                    |
| `status`              | `job_status`                   | Current state: blocked, pending, running, or completed                      |
| `created_at`          | `timestamptz`                  | When the job was created                                                    |
| `scheduled_at`        | `timestamptz`                  | Earliest time the job can be acquired                                       |
| `completed_at`        | `timestamptz`                  | When the job completed (null until completed)                               |
| `completed_by`        | `text`                         | Worker ID that completed the job (null for workerless)                      |
| `attempt`             | `integer`                      | Number of processing attempts (starts at 0)                                 |
| `last_attempt_at`     | `timestamptz`                  | When the last attempt started                                               |
| `last_attempt_error`  | `jsonb`                        | Error from last failed attempt                                              |
| `leased_by`           | `text`                         | Worker ID holding the lease                                                 |
| `leased_until`        | `timestamptz`                  | Lease expiry time                                                           |
| `deduplication_key`   | `text`                         | Key for chain deduplication                                                 |
| `chain_trace_context` | `text`                         | W3C traceparent for chain-level spans                                       |
| `trace_context`       | `text`                         | W3C traceparent for job-level spans                                         |

The `chain_id` foreign key references `job(id)`, forming a self-referential relationship where all jobs in a chain point to the root job (chain_index = 0).

### Job Blocker Table

The `job_blocker` table tracks dependencies between jobs and chains:

| Column                | Type                     | Description                                  |
| --------------------- | ------------------------ | -------------------------------------------- |
| `job_id`              | foreign key to `job(id)` | The blocked job                              |
| `blocked_by_chain_id` | foreign key to `job(id)` | Root job ID of the blocker chain             |
| `index`               | `integer`                | Position in the blockers array               |
| `trace_context`       | `text`                   | PRODUCER span context for blocker resolution |

Primary key: `(job_id, blocked_by_chain_id)` — each job–blocker pair is unique.

### Migration Table

The `migration` table tracks applied schema migrations:

| Column       | Type          | Description                                                  |
| ------------ | ------------- | ------------------------------------------------------------ |
| `name`       | `text`        | Migration identifier (e.g., `20240101000000_initial_schema`) |
| `applied_at` | `timestamptz` | When the migration was applied                               |

## Indexes

All indexes use partial conditions (WHERE clauses) to minimize size and target specific query patterns.

### Job Acquisition

```sql
CREATE INDEX job_acquisition_idx
  ON job (type_name, scheduled_at)
  WHERE status = 'pending'
```

Speeds up `acquireJob` — only pending jobs participate in the index.

### Chain Uniqueness

```sql
CREATE UNIQUE INDEX job_chain_index_idx
  ON job (chain_id, chain_index)
```

Guarantees each position in a chain has exactly one job.

### Deduplication

```sql
CREATE INDEX job_deduplication_idx
  ON job (deduplication_key, created_at DESC)
  WHERE deduplication_key IS NOT NULL AND chain_index = 0
```

Fast lookup for existing chains with the same deduplication key. Only root jobs (chain_index = 0) are indexed.

### Lease Expiry

```sql
CREATE INDEX job_expired_lease_idx
  ON job (type_name, leased_until)
  WHERE status = 'running' AND leased_until IS NOT NULL
```

The reaper uses this to find timed-out jobs efficiently.

### Blocker Lookups

```sql
CREATE INDEX job_blocker_chain_idx
  ON job_blocker (blocked_by_chain_id)
```

Fast reverse lookup — given a completed chain, find all jobs it was blocking.

### Listing Indexes

Five indexes support the listing and filtering queries used by the dashboard and `listJobs`/`listJobChains` APIs:

```sql
CREATE INDEX job_chain_listing_idx            ON job (created_at DESC) WHERE chain_index = 0
CREATE INDEX job_listing_idx                  ON job (created_at DESC)
CREATE INDEX job_listing_status_idx           ON job (status, created_at DESC)
CREATE INDEX job_listing_type_name_idx        ON job (type_name, created_at DESC)
CREATE INDEX job_chain_listing_type_name_idx  ON job (type_name, created_at DESC) WHERE chain_index = 0
```

## Locking

The adapter uses row-level locking exclusively — no advisory locks.

### FOR UPDATE SKIP LOCKED — Job Acquisition

The core acquisition query atomically selects and claims a job:

```sql
WITH acquired_job AS (
  SELECT id FROM job
  WHERE type_name IN (...)
    AND status = 'pending'
    AND scheduled_at <= now()
  ORDER BY scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE job SET status = 'running', attempt = attempt + 1
WHERE id = (SELECT id FROM acquired_job)
RETURNING *, EXISTS(...) AS has_more
```

`FOR UPDATE SKIP LOCKED` is the key mechanism:

- **FOR UPDATE** locks the selected row, preventing other transactions from modifying it
- **SKIP LOCKED** skips rows already locked by other transactions instead of waiting

This means multiple workers can acquire jobs concurrently without blocking each other — each worker atomically claims the next available job. The `has_more` flag in RETURNING tells the worker whether to immediately attempt another acquisition or wait for a notification.

The same pattern is used for lease reaping (`reapExpiredJobLease`), where expired leases are reclaimed without blocking active transactions.

### FOR UPDATE — Mutations

Operations that modify a specific job (e.g., completing a job, renewing a lease) use `FOR UPDATE` without `SKIP LOCKED`:

```sql
SELECT * FROM job WHERE id = $1 FOR UPDATE
```

This blocks until the row is available, ensuring the operation sees the latest state. Used in `getJobForUpdate` and `getLatestChainJobForUpdate`.

### Deadlock Prevention in Deletion

When deleting connected chains, the adapter locks rows in physical (`ctid`) order:

```sql
SELECT id FROM job WHERE chain_id = ANY($1) ORDER BY ctid FOR UPDATE
```

Ordering by `ctid` ensures all concurrent deletions acquire locks in the same physical order, preventing deadlock cycles that would occur with arbitrary ordering.

### Transaction Management

The adapter uses explicit `BEGIN`/`COMMIT`/`ROLLBACK` with savepoints for nested operations:

```sql
SAVEPOINT queuert_sp
-- user callback executes here
RELEASE SAVEPOINT queuert_sp
-- or on error: ROLLBACK TO SAVEPOINT queuert_sp
```

Savepoints enable partial rollback within a transaction — if a user callback fails, the savepoint rolls back its effects without aborting the entire transaction.

## Notifications (LISTEN/NOTIFY)

PostgreSQL's built-in `LISTEN`/`NOTIFY` mechanism provides low-latency event delivery between processes without polling.

### Channels

The adapter uses three notification channels (configurable prefix, default `queuert`):

| Channel           | Published When                  | Payload       | Purpose                             |
| ----------------- | ------------------------------- | ------------- | ----------------------------------- |
| `{prefix}_sched`  | Jobs become pending             | Job type name | Wake idle workers                   |
| `{prefix}_chainc` | Chain completes                 | Chain ID      | Wake clients awaiting chain results |
| `{prefix}_owls`   | Lease expires and job is reaped | Job ID        | Notify workers of ownership loss    |

### Publishing

Notifications are published via `pg_notify()`:

```sql
SELECT pg_notify($1, $2)
```

When called inside `runInTransaction`, the notification is delivered after the transaction commits — PostgreSQL guarantees this atomicity.

### Subscribing

Each channel subscription maintains a dedicated connection that issues `LISTEN` and stays open, receiving events via the PostgreSQL protocol's asynchronous notification mechanism. The adapter uses a shared listener pattern that multiplexes multiple callbacks on a single subscription, lazily starting when the first subscriber registers and stopping when the last unsubscribes.

### No Hint Optimization

Unlike Redis and NATS, the PostgreSQL notify adapter does not implement hint-based thundering herd optimization. All listening workers query the database on each notification. This is acceptable because `FOR UPDATE SKIP LOCKED` ensures only one worker acquires each job — redundant queries are cheap, not harmful.

## CTE Patterns

The adapter uses CTEs (Common Table Expressions) extensively to perform multi-step operations in a single round-trip:

- **Job creation**: Deduplication check + batch INSERT in one query
- **Blocker management**: INSERT blockers + UPDATE job status from pending to blocked
- **Unblocking**: DELETE resolved blockers + UPDATE jobs from blocked to pending (when all blockers resolved)
- **Chain deletion**: Recursive CTE to find connected chains + cascading DELETE
- **Connected chain discovery**: Recursive CTE traversing blocker relationships in both directions

All writeable CTEs use `RETURNING` to propagate results between steps without additional round-trips.

## Listing Queries and Vacuum

`listJobChains` joins each root row with the last job in the chain via a lateral subquery. The `status` filter applies to the joined last job and cannot use an index — only `typeName` and date range filters narrow the scan before the join. Without these filters, every root row is scanned and joined.

Listing queries hold an MVCC snapshot for their duration. On tables with frequent writes, unfiltered scans hold snapshots longer, preventing autovacuum from reclaiming dead tuples and causing table bloat over time.

`listJobs` uses straightforward indexed scans without a join and is efficient at any scale.

## See Also

- [Adapter Architecture](../adapters/) — Provider/adapter design philosophy
- [PostgreSQL Reference](/queuert/reference/postgres/) — API documentation
- [SQLite Internals](../sqlite-internals/) — SQLite-specific implementation
