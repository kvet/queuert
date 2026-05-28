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

| Column                | Type                           | Description                                                                                                                                     |
| --------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | configurable (default: `uuid`) | Primary key. Type is set via `idType`; values are generated in JS via `generateId`                                                              |
| `type_name`           | `text`                         | Job type identifier                                                                                                                             |
| `chain_id`            | same as `id`                   | Foreign key to root job — every job in a chain points to the root                                                                               |
| `chain_type_name`     | `text`                         | Type name of the chain (copied from root for query efficiency)                                                                                  |
| `chain_index`         | `integer`                      | Position in chain (0 for root, incrementing for continuations)                                                                                  |
| `continued_to_job_id` | same as `id`                   | FK to the next job in the chain — non-null exactly when this job has a successor (set transactionally when `continueWith` inserts the next row) |
| `input`               | `jsonb`                        | Job input data                                                                                                                                  |
| `output`              | `jsonb`                        | Completion output (null until completed)                                                                                                        |
| `status`              | `job_status`                   | Current state: blocked, pending, running, or completed                                                                                          |
| `created_at`          | `timestamptz`                  | When the job was created                                                                                                                        |
| `scheduled_at`        | `timestamptz`                  | Earliest time the job can be acquired                                                                                                           |
| `completed_at`        | `timestamptz`                  | When the job completed (null until completed)                                                                                                   |
| `completed_by`        | `text`                         | Worker ID that completed the job (null for workerless)                                                                                          |
| `attempt`             | `integer`                      | Number of processing attempts (starts at 0)                                                                                                     |
| `last_attempt_at`     | `timestamptz`                  | When the last attempt started                                                                                                                   |
| `last_attempt_error`  | `jsonb`                        | Error from last failed attempt                                                                                                                  |
| `leased_by`           | `text`                         | Worker ID holding the lease                                                                                                                     |
| `leased_until`        | `timestamptz`                  | Lease expiry time                                                                                                                               |
| `deduplication_key`   | `text`                         | Key for chain deduplication                                                                                                                     |
| `chain_trace_context` | `text`                         | W3C traceparent for chain-level spans                                                                                                           |
| `trace_context`       | `text`                         | W3C traceparent for job-level spans                                                                                                             |

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
CREATE UNIQUE INDEX chain_index_idx
  ON job (chain_id, chain_index)
```

Guarantees each position in a chain has exactly one job. Also serves as the race-decider for `continueWith`: two concurrent attempts both compute `chain_index = N + 1`, the loser's INSERT short-circuits via `ON CONFLICT (chain_id, chain_index) DO UPDATE SET id = id RETURNING *` and returns the winner's row.

### Continuation Pointer

```sql
CREATE UNIQUE INDEX continued_to_job_id_idx
  ON job (continued_to_job_id)
  WHERE continued_to_job_id IS NOT NULL
```

Enforces that no two jobs share the same successor and supports cursor decoding for `listChainJobs` (the cursor is an opaque job id; the SQL resolves the next-page boundary by joining `c.continued_to_job_id = n.id`).

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

Five indexes support the listing and filtering queries used by the dashboard and `listJobs`/`listChains` APIs:

```sql
CREATE INDEX chain_listing_idx            ON job (created_at DESC) WHERE chain_index = 0
CREATE INDEX job_listing_idx                  ON job (created_at DESC)
CREATE INDEX job_listing_status_idx           ON job (status, created_at DESC)
CREATE INDEX job_listing_type_name_idx        ON job (type_name, created_at DESC)
CREATE INDEX chain_listing_type_name_idx  ON job (type_name, created_at DESC) WHERE chain_index = 0
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

This blocks until the row is available, ensuring the operation sees the latest state. Used by `getJob` and `getChain` when called with `lock: "exclusive"` from inside a transaction.

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

When called inside `withTransaction`, the notification is delivered after the transaction commits — PostgreSQL guarantees this atomicity.

### Subscribing

Each channel subscription maintains a dedicated connection that issues `LISTEN` and stays open, receiving events via the PostgreSQL protocol's asynchronous notification mechanism. The adapter uses a shared listener pattern that multiplexes multiple callbacks on a single subscription, lazily starting when the first subscriber registers and stopping when the last unsubscribes.

### No Hint Optimization

Unlike Redis and NATS, the PostgreSQL notify adapter does not implement hint-based thundering herd optimization. All listening workers query the database on each notification. This is acceptable because `FOR UPDATE SKIP LOCKED` ensures only one worker acquires each job — redundant queries are cheap, not harmful.

## CTE Patterns

The adapter uses CTEs (Common Table Expressions) extensively to perform multi-step operations in a single round-trip:

- **Job creation**: Deduplication check + batch INSERT in one query
- **Blocker management**: INSERT blockers + UPDATE job status from pending to blocked
- **Unblocking**: UPDATE jobs from blocked to pending when all their blockers have completed (blocker rows are retained to propagate trace context into the unblocked job)
- **Chain deletion**: Recursive CTE to find connected chains + cascading DELETE
- **Connected chain discovery**: Recursive CTE traversing blocker relationships in both directions

All writeable CTEs use `RETURNING` to propagate results between steps without additional round-trips.

## Vacuum Tuning

The adapter configures aggressive autovacuum and storage settings on the job tables via the `vacuum_tuning` migration:

### Fillfactor

```sql
ALTER TABLE job SET (fillfactor = 75);
```

Fillfactor reserves 25% free space per heap page. Jobs go through multiple in-place status updates (pending → running → completed, plus lease renewals), and PostgreSQL can perform these as HOT (Heap-Only Tuple) updates when free space is available in the same page. HOT updates avoid creating new index entries, reducing both index bloat and vacuum workload.

The `job_blocker` table does not set a fillfactor because blockers are inserted and deleted without intermediate updates.

### Autovacuum

```sql
ALTER TABLE job SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay = 0
);
```

| Setting                           | Default   | Configured | Effect                                              |
| --------------------------------- | --------- | ---------- | --------------------------------------------------- |
| `autovacuum_vacuum_scale_factor`  | 0.2 (20%) | 0.02 (2%)  | Triggers vacuum after 2% dead tuples instead of 20% |
| `autovacuum_analyze_scale_factor` | 0.1 (10%) | 0.02 (2%)  | Re-analyzes planner statistics after 2% row changes |
| `autovacuum_vacuum_cost_delay`    | 2ms       | 0          | Removes I/O throttling — vacuum runs at full speed  |

These settings are applied per-table (not server-wide) to the `job` table. The `job_blocker` table sets only `autovacuum_vacuum_cost_delay = 0` since blockers are inserted and deleted without intermediate updates, producing less churn than the job table.

### On-Demand Vacuum

The adapter also exposes a `vacuum()` method that runs `VACUUM` on both job tables:

```typescript
await stateAdapter.vacuum();
```

PostgreSQL's `VACUUM` (without `FULL`) does not block reads or writes — it reclaims dead tuples while the tables remain accessible. This complements autovacuum for cases where immediate reclamation is desired (e.g., after a large batch deletion in the cleanup job).

## Listing Queries and Vacuum

`listChains` joins each root row with the last job in the chain via a lateral subquery. The `status` filter applies to the joined last job and cannot use an index — only `typeName` and date range filters narrow the scan before the join. Without these filters, every root row is scanned and joined.

Listing queries hold an MVCC snapshot for their duration. On tables with frequent writes, unfiltered scans hold snapshots longer, preventing autovacuum from reclaiming dead tuples and causing table bloat over time. The aggressive autovacuum settings above help mitigate this by reclaiming dead tuples more frequently between listing scans.

`listJobs` uses straightforward indexed scans without a join and is efficient at any scale.

## See Also

- [Adapter Architecture](../adapters/) — Provider/adapter design philosophy
- [PostgreSQL Reference](/queuert/reference/postgres/) — API documentation
- [SQLite Internals](../sqlite-internals/) — SQLite-specific implementation
