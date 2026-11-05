# PostgreSQL isolation levels

Make the PostgreSQL state adapter correct when the transactions a user passes in run at REPEATABLE READ or SERIALIZABLE, by replacing lock-then-recheck blocker bookkeeping with counters (`has_dependents` on the blocker's head job, `blockers_remaining` on the dependent), and by pinning the transactions Queuert opens itself to READ COMMITTED.

## Problem

Two invariants pair a read in one transaction with a write in another:

- **Attach vs completion of the blocker.** `addJobsBlockers` locks the blocker's head job and reads `chain_status`; the completer's `unblockJobs` reads `job_blocker` to find dependents.
- **Two blockers of one dependent completing concurrently.** `unblockJobs` locks the blocked dependents (`lockBlockedJobs`), then recomputes `NOT EXISTS (incomplete blocker)` in a second statement.

Both rely on READ COMMITTED taking a fresh snapshot per statement after a lock wait. Under REPEATABLE READ the snapshot is fixed at the transaction's first statement, and a row that the other transaction only _locked_ (not wrote) raises no serialization failure. Both sides commit and the dependent stays `blocked` forever. SERIALIZABLE is correct today (SSI aborts one side of the write skew); REPEATABLE READ is silently wrong.

A raw-SQL spike (PostgreSQL 14, two-connection interleavings) reproduced it:

| Race                                                | RC  | RR            | SER           |
| --------------------------------------------------- | --- | ------------- | ------------- |
| Attach commits inside the completer's snapshot      | ok  | **stuck**     | 40001 → retry |
| Completer waits on the attacher's lock              | ok  | **stuck**     | 40001 → retry |
| Completion commits inside the attacher's snapshot   | ok  | 40001 → retry | 40001 → retry |
| Two blockers of one dependent complete concurrently | ok  | **stuck**     | 40001 → retry |

Under load (200 dependents × 16 blockers completed by 8 connections at RR) 6–8 dependents were left `blocked`.

## Design

Rule: **every invariant that pairs a read in one transaction with a write in another must be a write-write conflict on a shared row.** READ COMMITTED then waits and re-reads the latest version (EvalPlanQual); REPEATABLE READ and SERIALIZABLE raise 40001 and the caller retries.

### Schema

On `job`:

- `has_dependents boolean NOT NULL DEFAULT false` — meaningful on head jobs: at least one `job_blocker` row references this chain.
- `blockers_remaining integer NOT NULL DEFAULT 0` — meaningful on `blocked` jobs: the number of this job's `job_blocker` rows whose blocker chain is not `completed`. Duplicate blocker chains at different `index` positions count once per row.

Neither column is indexed, so writes that change only these columns can be HOT updates.

### Attach (`addJobsBlockers`)

1. Lock the blocker head jobs in id order (`ORDER BY h.id FOR UPDATE`), as today. The lock stays a `SELECT … FOR UPDATE`: a bare `UPDATE` cannot order its row locks, and in the spike it deadlocked on 119 of 2000 concurrent multi-blocker attaches.
2. Write `has_dependents = true` on each locked head when it is `false`, **or** when `current_setting('transaction_isolation') = 'repeatable read'`. At READ COMMITTED the lock is enough once the flag is set (the completer re-reads after its wait, the unblock statement takes a new snapshot); at SERIALIZABLE SSI detects the rw-conflict; at REPEATABLE READ only a write produces the conflict.
3. Insert the `job_blocker` rows.
4. Set the dependent's `blockers_remaining` to the number of its `job_blocker` rows whose locked head is `running`, and its status to `blocked` when that number is above zero.

All four stay one statement, as `addJobsBlockers` is today.

### Completion (`completeJobs` + `unblockJobs`)

- `completeJobs` returns the chain head's `has_dependents` as `hasDependents` on each result, taken from the `UPDATE … RETURNING` that completes the chain (the head itself for a single-job chain, `head_done` otherwise). After a lock wait this is the latest version.
- Core skips `unblockJobs` when `hasDependents` is `false`. This replaces `lockBlockedJobs`' `EXISTS` round trip on every chain completion without dependents.
- `unblockJobs` is one statement: lock the dependents that are `blocked` and have `job_blocker` rows for the completed chain, in id order (`MATERIALIZED` CTE, `FOR UPDATE`); then decrement `blockers_remaining` by each dependent's row count for that chain, and move it to `pending` with `scheduled_at = GREATEST(scheduled_at, statement_timestamp())` when the result reaches zero. Every completion writes every dependent it counts down, so concurrent completers of one dependent always conflict on its row. The `NOT EXISTS` scan over all of a dependent's blockers goes away.
- `unblockJobs` keeps returning one `StateDependentJob` per `job_blocker` row (for blocker spans), as today.

### Transactions Queuert opens

The PostgreSQL adapter's `withTransaction` (used by the worker: start, reclaim, stop, acquisition) issues `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` as its first statement, so a session `default_transaction_isolation` of REPEATABLE READ or SERIALIZABLE never applies to them. Queuert's autocommit statements (lease renewal, the fallback reschedule) remain single statements at the session default; a 40001 there is a transient database error, which the worker already tolerates and retries on its next poll.

Only the transactions a user passes in (client methods, `complete`, `fence`) run at the user's level.

### Serialization failures in user transactions

Unchanged: a 40001 or 40P01 raised in a transaction passed to `complete` fails the attempt like any other error, and the job is rescheduled with backoff. Client methods throw it to the caller. Retrying is the caller's concern and is documented.

### SQLite and in-process

SQLite serializes writers and the in-process adapter serializes through its lock, so neither has the race. Both keep recomputing readiness and take no migration; they only implement the contract change: `completeJobs` returns `hasDependents` (an `EXISTS` over `job_blocker` for the completed chain).

## Behavior by isolation level

| Race                                                | RC      | RR            | SER           |
| --------------------------------------------------- | ------- | ------------- | ------------- |
| Attach vs completion of the blocker (any order)     | correct | 40001 → retry | 40001 → retry |
| Two blockers of one dependent complete concurrently | correct | 40001 → retry | 40001 → retry |
| Attach after the blocker's head was acquired        | —       | 40001 → retry | 40001 → retry |

The last row is head-row aliasing, unchanged by this design; `design/chain-table.md` removes it.

## Performance

Spike harness: the adapter's statements in raw SQL, 8 connections, 3 rotated rounds, PostgreSQL 14. Treat differences under about 10% as noise. Columns: ops/s · WAL bytes per op.

| Scenario                              | Level | Today         | This design   |
| ------------------------------------- | ----- | ------------- | ------------- |
| Chain completion, no dependents       | RC    | 3,762 · 627   | 5,083 · 622   |
| Attach, 16 hot blockers               | RC    | 2,325 · 1,514 | 2,373 · 1,556 |
| Attach, 4096 cold blockers            | RC    | 2,583 · 1,520 | 2,447 · 1,661 |
| Fan-in, 200 dependents × 16 blockers  | RC    | 2,588 · 745   | 3,294 · 848   |
| Barrier, 2000 dependents × 8 blockers | RC    | 78 · 255 k    | 77 · 412 k    |
| Attach, 16 hot blockers               | RR    | incorrect     | 1,646 · 1,876 |
| Fan-in, 200 dependents × 16 blockers  | RR    | incorrect     | 3,201 · 847   |

- Completions without dependents gain about 35% (one statement instead of two); fan-in gains about 25% (no `NOT EXISTS` scan).
- WAL grows by about 9% per first attach to a blocker (the flag write) and by about 14% on fan-in. A barrier writes every dependent on every completion (+60% WAL, HOT), at unchanged throughput.
- At REPEATABLE READ, 4.5% of attach transactions to hot blockers hit 40001. The write that makes RR correct is what conflicts, so no RR-correct variant avoids it.
- At SERIALIZABLE, about 28% of attach transactions abort even on uncontended blockers, with or without this design (380 vs 2,500 attaches/s at RC): SSI predicate-lock conflicts on `job_blocker` and index pages. Correct but slow; documented, not addressed here.

## Migration (`003_blocker_counters`)

One transactional migration after `002_worker_liveness`, with `SET LOCAL lock_timeout` as in `002`:

1. Add `has_dependents` and `blockers_remaining` (constant defaults: no table rewrite).
2. Set `has_dependents = true` on every head job referenced by a `job_blocker` row.
3. Set `blockers_remaining` on every `blocked` job to the number of its `job_blocker` rows whose blocker head's `chain_status` is distinct from `completed` (the same predicate as today's recompute, so a missing head counts as incomplete).
4. Move `blocked` jobs whose `blockers_remaining` is zero to `pending` with `scheduled_at = GREATEST(scheduled_at, now())`. These are dependents a previous release left stuck; none exist on a database that only ever ran at READ COMMITTED.

A process from before `003` completes blockers without decrementing counters, so it must not run alongside a process after it. `002_worker_liveness` already requires stopping every previous-version process; shipping `003` in the same release keeps a single stop-the-world upgrade. A later release has to document its own.

## API

- State adapter contract: each `completeJobs` result carries `hasDependents: boolean`; `unblockJobs` is documented as called only when it is `true`. This is a breaking change for custom state adapters.
- No change to the client, worker or processor API.
- Docs: the "Isolation level" section of the PostgreSQL integration page states that READ COMMITTED, REPEATABLE READ and SERIALIZABLE are supported, that transactions passed to Queuert can raise 40001/40P01 at the stricter levels and should be retried by the caller, the contention cost of attaching many dependents to one blocker at REPEATABLE READ, and the SSI abort rate at SERIALIZABLE. The schema reference lists the two columns.

## Tests

- PostgreSQL, two connections, at READ COMMITTED, REPEATABLE READ and SERIALIZABLE: each race in the table above ends with the dependent `pending` (with retries where the table says 40001).
- PostgreSQL: concurrent multi-blocker attaches and concurrent fan-in completions raise no 40P01.
- PostgreSQL: after the existing blocker conformance cases, every `blocked` job's `blockers_remaining` equals its recomputed count.
- PostgreSQL: the processing suites run with `default_transaction_isolation` set to `repeatable read` and to `serializable`; Queuert-owned transactions report `read committed` (`current_setting('transaction_isolation')`).
- Conformance (all adapters): `completeJobs` returns `hasDependents` true exactly when a `job_blocker` row references the completed chain.
- Migration: a seeded pre-`003` database with blocked dependents waiting on mixed `running`/`completed` blockers, duplicate blocker chains, and a stuck dependent whose blockers all completed; after `003` the counters match the recompute and the stuck dependent is `pending`.

## Related designs

- **Chain table** (`design/chain-table.md`): moves `has_dependents` from the head job row to the `chain` row; `blockers_remaining` stays on `job`. Its write-based bookkeeping section is this design applied to the split schema.
- **Unbounded blockers** (`design/unbounded-blockers.md`): its `job_blocker.blocked` flip has to follow the same write-based rule.
