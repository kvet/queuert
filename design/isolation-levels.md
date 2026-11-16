# Isolation levels

Make the PostgreSQL and MySQL / MariaDB state adapters correct when any transaction that touches Queuert's tables runs at READ COMMITTED, REPEATABLE READ or SERIALIZABLE, including mixes of levels across transactions. REPEATABLE READ is InnoDB's default, so most MySQL users pass it in without knowing; today the docs of both adapters ask for READ COMMITTED. The design rests on four changes:

- Every cross-transaction invariant becomes a write-write conflict on a shared row: counter-based blocker bookkeeping (`has_dependents`, `blockers_remaining`) and, on PostgreSQL, a write on the worker row during acquisition. On InnoDB, every read that drives such a write is also a current read.
- The adapters retry serialization failures and deadlocks in the work Queuert runs itself.
- The providers stop pinning READ COMMITTED (0.18 opens every transaction with `BEGIN ISOLATION LEVEL READ COMMITTED` on PostgreSQL and `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` on MySQL). Only migrations stay pinned. Every other transaction, Queuert's own included, runs at the level the user's connection or transaction chooses.
- `blockers_remaining` joins `002_blocker_counters` before that migration is released, so users take one breaking migration and one fence bump.

Claims marked _(spike)_ for MySQL were verified against MySQL 8.0.46, MySQL 8.4.13, MariaDB 10.11.19, MariaDB 11.4.13 and MariaDB 11.8.9 with mysql2 3.24, by a spike run before the adapter was written. The MySQL adapter itself has been tested at READ COMMITTED only.

## Problem

### PostgreSQL

Three invariants pair a read in one transaction with a write in another, and only a row **lock** links the two:

- **Attach vs completion of the blocker.** `addJobsBlockers` locks the blocker's head job and reads `chain_status`; the completer's `unblockJobs` reads `job_blocker` to find dependents.
- **Two blockers of one dependent completing concurrently.** `unblockJobs` locks the blocked dependents (`lockBlockedJobs`), then recomputes `NOT EXISTS (incomplete blocker)` in a second statement.
- **Acquisition vs reclaim of an expired worker.** `startJobAttempts` takes `FOR KEY SHARE` on the worker row and writes `attempt_by` on the acquired jobs; the reclaimer locks the worker row `FOR UPDATE`, lists the worker's running jobs, reschedules them and deletes the worker.

All three rely on READ COMMITTED taking a fresh snapshot per statement after a lock wait. Under REPEATABLE READ the snapshot is fixed at the transaction's first statement. If the other transaction only _locked_ a row and never wrote it, no serialization failure is raised, so both sides commit:

- In the blocker races, the dependent stays `blocked` forever.
- In the worker race, the reclaimer misses a job acquired by a worker whose acquisition statement started just before its lease expired. The reclaimer then deletes the worker row. If that process dies before settling the attempt, the job stays `running` with an `attempt_by` that no worker row matches. Nothing reclaims it, and no foreign key on `attempt_by` catches it.

SERIALIZABLE detects these write skews only when **both** sides are SERIALIZABLE. Levels can differ per transaction (`BEGIN ISOLATION LEVEL …`), so the design cannot assume a uniform level, and a write made conditional on the writer's own level does not help.

Two more problems come from the session default once the providers stop pinning:

- Acquisition (`startJobAttempts`, `getStartAttemptDelayMs`) runs as autocommit statements. At REPEATABLE READ, `FOR UPDATE … SKIP LOCKED` raises 40001 on a row that another worker acquired and committed after the statement's snapshot, because SKIP LOCKED only skips rows that are still locked. The batch is lost and the worker enters recovery backoff.
- Migrations take their advisory lock in the transaction's first statement, so at REPEATABLE READ the snapshot is fixed before the wait. Three failures follow (see [Migrations](#migrations)).

Raw-SQL spikes (PostgreSQL 14, two-connection interleavings) reproduced the lock-only races. The first spike ran both sides at the same level; the second set each side's level independently:

| Race (today's statements)                               | Broken                                                  |
| ------------------------------------------------------- | ------------------------------------------------------- |
| Attach commits inside the completer's snapshot          | RR (same level on both sides)                           |
| Completer waits on the attacher's head lock             | RR (same level on both sides)                           |
| Two blockers of one dependent complete concurrently     | RR (same level on both sides)                           |
| Attach with `has_dependents` already true vs completion | attacher/completer RC/RR, RC/SER, SER/RR                |
| Acquisition (`FOR KEY SHARE`) vs reclaim: job orphaned  | acquirer/reclaimer RC/RR, RC/SER, RR/RR, RR/SER, SER/RR |

Under load (200 dependents × 16 blockers completed by 8 connections at REPEATABLE READ), 6–8 dependents were left `blocked`. With the changes below, all nine level pairs of the last two races end correctly, with one 40001 retry where a side is REPEATABLE READ or SERIALIZABLE. The worker-owned transactions (own-job reclaim vs own `complete`, stop vs reclaim as expired) were correct in all nine pairs already.

### MySQL / MariaDB

Today the MySQL adapter keeps blockers the way PostgreSQL does at READ COMMITTED: `unblockJobs` locks the blocked dependents and rechecks `job_blocker` for an incomplete blocker. That is correct at RC and leaves dependents stuck at RR.

What InnoDB does differently from PostgreSQL, each fact verified on MySQL 8.4, MariaDB 11.4 and MariaDB 11.8 _(spike)_:

- **Current reads see past the snapshot at any level.** `FOR UPDATE`, `LOCK IN SHARE MODE`, `UPDATE` and `DELETE` read the latest committed version, including phantom rows. A plain `SELECT` at RR reads a snapshot fixed at the transaction's first consistent read, not at `START TRANSACTION`. With the default settings, a write over a row that changed after the snapshot raises no error. PostgreSQL's 40001 has no counterpart.
- **A subquery under `SELECT … FOR UPDATE` is a snapshot read.** A subquery inside an `UPDATE` is a current read. In `SELECT … WHERE id IN (SELECT job_id FROM job_blocker …) FOR UPDATE`, the subquery missed a `job_blocker` row committed after the snapshot.
- **RR takes next-key and gap locks on locking range scans.** RC takes none, apart from duplicate checks.
- **SERIALIZABLE turns plain `SELECT`s into share-locking reads** inside a transaction. This masks plain-read bugs, at the cost of more lock waits and deadlocks.
- **MariaDB `innodb_snapshot_isolation`** defaults ON from 11.6 and is OFF on 11.4. While ON, at RR and SERIALIZABLE, a locking read or write of a row changed after the snapshot raises **1020** and rolls back the whole transaction. It does not fix plain-read bugs.
- **1213** (deadlock) rolls back the whole transaction, and the connection then continues in autocommit. **1205** (lock wait timeout) rolls back only the statement, unless the server runs with `innodb_rollback_on_timeout`.

The blocker races, run with two connections and controlled interleavings. Every transaction first runs a plain `SELECT`, which fixes its snapshot. "Stuck" means the dependent stayed `blocked` with no incomplete blockers; "retry" means one side raised the listed error and a retry succeeded _(spike)_:

| Variant                                          | Race                                   | RC           | RR                              | SER                             |
| ------------------------------------------------ | -------------------------------------- | ------------ | ------------------------------- | ------------------------------- |
| PostgreSQL statements, literally translated      | attach vs completion                   | ok           | **stuck**                       | ok (MariaDB 11.8: 1020 → retry) |
|                                                  | two blockers of one dependent complete | ok           | **stuck**                       | 1213 → retry                    |
| Lock-then-recheck with every read a current read | attach vs completion                   | ok           | ok                              | ok                              |
|                                                  | two blockers complete                  | 1213 → retry | 1213 → retry                    | 1213 → retry                    |
| Counters, `job_blocker` read by plain `SELECT`   | attach vs completion                   | ok           | **stuck**                       | ok                              |
| Counters, current reads (this design)            | all races                              | ok           | ok (MariaDB 11.8: 1020 → retry) | ok (MariaDB 11.8: 1020 → retry) |

Under load (8 connections, 200 dependents × 16 blockers, RR), the counter design left 0 dependents stuck with 0 errors, except on MariaDB 11.8 with snapshot isolation ON, where it needed about 84 retries of 1020. No counter drift was observed _(spike)_.

## Design

Rule: **every invariant that pairs a read in one transaction with a write in another must be a write-write conflict on a shared row, whatever level each side runs at.** On PostgreSQL, READ COMMITTED then waits and re-reads the latest version (EvalPlanQual); REPEATABLE READ and SERIALIZABLE raise 40001. On InnoDB, the second writer waits and then updates the latest version, and **every read that drives such a write must be a current read**. The caller retries: the user for their own transactions, the adapter for Queuert's.

### Schema

On `job`, on both adapters:

- `has_dependents boolean NOT NULL DEFAULT false` — meaningful on head jobs: at least one `job_blocker` row references this chain. It is never cleared, so `true` can outlive the rows.
- `blockers_remaining integer NOT NULL DEFAULT 0` — meaningful on `blocked` jobs: the number of this job's `job_blocker` rows whose blocker chain is not `completed`. Duplicate blocker chains at different `index` positions count once per row.

On PostgreSQL, `blockers_remaining` is not indexed, so writes that change only it can be HOT updates. The `worker` table needs no change.

### Attach (`addJobsBlockers`)

PostgreSQL:

1. Lock the blocker head jobs in id order (`ORDER BY h.id FOR UPDATE`), as today. The lock stays a `SELECT … FOR UPDATE`: a bare `UPDATE` cannot order its row locks, and in the spike it deadlocked on 119 of 2000 concurrent multi-blocker attaches.
2. Write `has_dependents = true` on **every** locked head, including heads where it is already `true`. The conflict has to exist whenever the _completer_ might be at REPEATABLE READ or SERIALIZABLE, and the attacher cannot know the completer's level.
3. Insert the `job_blocker` rows.
4. Set the dependent's `blockers_remaining` to the number of its `job_blocker` rows whose locked head is `running`, and its status to `blocked` when that number is above zero.

All four stay one statement, as `addJobsBlockers` is today.

The same write covers `deleteChains`. A deletion whose snapshot predates a committed attach to the chain raises 40001 when it locks the head, instead of reading `job_blocker` from a stale snapshot and deleting a chain that is still referenced.

MySQL locks the blocker heads in id order with a driven lock (`JSON_TABLE` `STRAIGHT_JOIN` `job` `FORCE INDEX (PRIMARY)`), sets `has_dependents` on heads where it is false, inserts the `job_blocker` rows, and adds to each dependent's `blockers_remaining` the number of its locked heads that are still running. The flag write can stay conditional: the head lock alone links attacher and completer, because the completer's locking read of the head is a current read and sees the latest committed flag at any level.

### Completion (`completeJobs` + `unblockJobs`)

- `completeJobs` returns the chain head's `has_dependents` as `hasDependents` on each result. PostgreSQL takes it from the `UPDATE … RETURNING` that completes the chain (the head itself for a single-job chain, `head_done` otherwise); after a lock wait this is the latest version. MySQL reads it from the head row it just updated, with a locking read.
- Core skips `unblockJobs` when `hasDependents` is `false`. This replaces `lockBlockedJobs`' `EXISTS` round trip on every chain completion without dependents.
- On PostgreSQL, `unblockJobs` is one statement:
  1. Lock, in id order (`MATERIALIZED` CTE, `FOR UPDATE`), the dependents that are `blocked` and have `job_blocker` rows for the completed chain.
  2. Decrement each one's `blockers_remaining` by its row count for that chain.
  3. Move it to `pending` with `scheduled_at = GREATEST(scheduled_at, statement_timestamp())` when the result reaches zero.
- On MySQL, `unblockJobs` share-locks the `job_blocker` rows of the completed chain (a current read), then decrements `blockers_remaining` on those dependents in id order in one `UPDATE`, setting `pending` where it reaches zero. Every expression uses old values and `blockers_remaining` is assigned last, so the statement is correct under both left-to-right and simultaneous assignment.

Every completion writes every dependent it counts down, so concurrent completers of one dependent always conflict on its row. The `NOT EXISTS` scan over all of a dependent's blockers goes away. `unblockJobs` keeps returning one `StateDependentJob` per `job_blocker` row (for blocker spans), as today.

### Acquisition (`startJobAttempts`)

On PostgreSQL, the `live_worker` CTE changes from `SELECT … FOR KEY SHARE` to a write:

```sql
live_worker AS (
  UPDATE {{schema}}.{{table_prefix}}worker w
  SET lease_until = w.lease_until
  WHERE w.id = $2 AND w.token = $4 AND w.lease_until > statement_timestamp()
  RETURNING w.id
)
```

`acquired_jobs` keeps its `WHERE EXISTS (SELECT 1 FROM live_worker)` guard. The write makes acquisition and reclaim of the same worker conflict:

- The reclaimer locks first: the acquisition waits. At READ COMMITTED it re-reads, finds the row deleted and acquires nothing. At the stricter levels it raises 40001, and the retry finds the row gone.
- The acquisition writes first: the reclaimer's `FOR UPDATE` waits. At READ COMMITTED its following statements see the acquired jobs. At the stricter levels it raises 40001, and the retry sees them.

Both paths take the worker row before any job row, so the lock order does not change. One worker's acquisitions run one at a time in its loop, so the write adds no contention between acquisitions. It does conflict with the worker's own lease renewal, which writes the same row: at the stricter levels, one of the two occasionally raises 40001 and is retried.

`FOR UPDATE … SKIP LOCKED` keeps raising 40001 at the stricter levels on rows another worker acquired after the snapshot (see [Problem](#postgresql)). Nothing avoids it short of READ COMMITTED; the retries below absorb it, at the cost measured under [Performance](#performance).

On MySQL, acquisition needs no write on the worker row: its `LOCK IN SHARE MODE` and the reclaimer's `FOR UPDATE` are both current reads, so the reclaimer sees every job an acquisition committed at any level. `SKIP LOCKED` raises no error for rows changed after the snapshot. At RR and SERIALIZABLE, however, the claim scan's locking range reads take gap locks _(spike)_:

- An `INSERT` of a new due job blocked until 1205 whenever a claim scan reached the end of the pending range, which is the normal state of a drained queue.
- On a drained queue at RR, MariaDB dropped from about 770 to about 97 completions/s, with 100–140 deadlocks in 10 s and producer p99 rising from 4 ms to about 200 ms. MySQL hit 215 deadlocks.

This is liveness, not correctness: deadlocks are retried, and a 1205 on an insert reaches the caller. The adapter does not pin a level to avoid it; the docs name a READ COMMITTED pool default for Queuert as the way out.

### Queuert's own transactions and statements

Neither adapter sets an isolation level on the transactions or autocommit statements Queuert issues, and the providers that ship with the adapters stop setting one:

- PostgreSQL: the `pg` pool provider and the `state-pg` example open transactions with a plain `BEGIN`.
- MySQL: the `mysql2` pool provider and the `state-mysql2`, `state-mariadb` and `state-bun-sql` examples drop `SET TRANSACTION ISOLATION LEVEL READ COMMITTED`.

They run at the session default, or at the level the provider's connection uses. A user who wants a stricter level for their own code without its acquisition cost can give the pool Queuert uses a READ COMMITTED default and raise the level per transaction in their own code.

### Retries in Queuert's own work

Each adapter retries its serialization and deadlock errors for the work Queuert runs itself: 40001 (`serialization_failure`) and 40P01 (`deadlock_detected`) on PostgreSQL, 1213 (deadlock) and 1020 (MariaDB snapshot isolation) on MySQL. 1205 is not retried.

- `withTransaction` (worker registration, own-job reclaim, expired-worker reclaim, stop): rolls back and calls `fn` again.
- Autocommit statements issued without a `txCtx` (acquisition, `getStartAttemptDelayMs`, lease renewal, the fallback reschedule, the reclaim candidate listing): re-executes the statement.
- Statements on a caller's `txCtx` are never retried.

Retries are bounded (5 attempts) with a short jittered delay (5–50 ms). When the attempts run out, the error is thrown, and the worker treats it as a transient database error, as today. Every retried unit is safe to re-run: the `withTransaction` callbacks in core only read and write the database, and their notifications and observability events run after commit.

### Migrations

Migrations always run at READ COMMITTED, on both adapters. They touch only Queuert's tables and run once per deploy, so the pin takes nothing from users who run everything else at a stricter level.

PostgreSQL:

- The migration store's `runInTransaction` and `initialize`, which run through the provider's `withTransaction`, issue `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` before the advisory lock.
- The lease statements (`acquireMigrationLock`, `extendMigrationLock`, `releaseMigrationLock`) run inside a READ COMMITTED transaction.

Without the pin, the spike showed three failures at REPEATABLE READ and SERIALIZABLE:

- **Lease acquisition.** When several replicas boot together, each one's `INSERT … ON CONFLICT DO UPDATE` collides with an insert that committed after its own snapshot, and raises 40001 instead of returning "not acquired". The migrator's poll loop does not catch it, so `migrateToLatest` throws on every replica except the one that inserted the row.
- **Advisory lock.** A run that waits on another run of the same migration reads `migration` without the other run's record. It re-executes the statements and then fails with 40001 when recording. Nothing is applied twice, but the run errors. This happens only after the lease was lost.
- **Backfills.** A data statement after an `ALTER TABLE` that waited for an open writer uses the snapshot from before the wait and silently skips the writer's rows.

MySQL migrations already run as non-transactional DDL with a table lease, outside any snapshot that matters, and data statements are rerunnable. The migration store pins its connection to READ COMMITTED so a backfill never reads a snapshot from before a metadata-lock wait.

### User transactions

Transactions passed to Queuert run at the user's level, and different user transactions may run at different levels.

- PostgreSQL: a 40001 or 40P01 raised in a transaction passed to `complete` fails the attempt like any other error, and the job is rescheduled with backoff. Client methods throw it to the caller.
- MySQL at RR (MySQL, MariaDB ≤ 11.5): correct, with no serialization errors: concurrent writers wait and then update the latest version. Queuert's blocker statements are point lookups by primary key, which take record locks only; the user's own locking range reads take gap locks as usual.
- MySQL at SERIALIZABLE: correct, with more lock waits. Plain reads become share locks, so expect 1213 under contention.
- MariaDB ≥ 11.6 at RR or SERIALIZABLE with `innodb_snapshot_isolation=ON`: correct, but 1020 also appears on benign interleavings, such as a completion committing inside an attacher's snapshot. Fan-in onto one dependent averaged about 5 retries per completion _(spike)_.
- A 1213 or 1020 fails the attempt or the client call like any other error. A 1205 leaves the transaction open with a statement missing; the rule that such a transaction must be rolled back already applies at RC.

Retrying is the caller's concern and is documented. A `complete` that succeeded in a rolled-back try refuses to run again with the same hooks, so a caller that retries a transaction either opens fresh `txHooks` for each try (a retry loop outside `withTxHooks`) or wraps each try in `txHooks.retryBoundary` (a retry loop inside it).

### SQLite and in-process

SQLite serializes writers and the in-process adapter serializes through its lock, so neither has these races. Both keep recomputing readiness, and SQLite's `002_blocker_counters` adds no `blockers_remaining`. They only implement the contract changes:

- `completeJobs` returns `hasDependents`: SQLite reads the head's stored `has_dependents` (added by `002_blocker_counters` for the `listChains` index), the in-process adapter its dependents index.
- `withTransaction` keeps calling `fn` once.

## Behavior by isolation level

Levels apply to either side of each race, mixed or not.

PostgreSQL:

| Race                                                | RC      | RR            | SER           |
| --------------------------------------------------- | ------- | ------------- | ------------- |
| Attach vs completion of the blocker (any order)     | correct | 40001 → retry | 40001 → retry |
| Attach vs deletion of the blocker chain             | correct | 40001 → retry | 40001 → retry |
| Two blockers of one dependent complete concurrently | correct | 40001 → retry | 40001 → retry |
| Acquisition vs reclaim of the acquiring worker      | correct | 40001 → retry | 40001 → retry |
| Lease renewal vs reclaim of the renewing worker     | correct | 40001 → retry | 40001 → retry |
| Acquisition vs another worker's acquisition         | correct | 40001 → retry | 40001 → retry |
| `fence` / `complete` vs reclaim of the attempt      | correct | 40001 → retry | 40001 → retry |
| Reclaim of own finished jobs vs own `complete`      | correct | 40001 → retry | 40001 → retry |
| Stop of own worker vs reclaim of it as expired      | correct | 40001 → retry | 40001 → retry |
| Attach after the blocker's head was acquired        | —       | 40001 → retry | 40001 → retry |

The last row is head-row aliasing, unchanged by this design; `design/chain-table.md` removes it.

MySQL / MariaDB, expected values, to be filled from the tests:

| Race                                                | RC      | RR (MySQL, MariaDB ≤ 11.5) | SER          | MariaDB ≥ 11.6, RR/SER, snapshot isolation ON |
| --------------------------------------------------- | ------- | -------------------------- | ------------ | --------------------------------------------- |
| Attach vs completion of the blocker (any order)     | correct | correct                    | correct      | 1020 → retry                                  |
| Attach vs deletion of the blocker chain             | correct | correct                    | correct      | 1020 → retry                                  |
| Two blockers of one dependent complete concurrently | correct | correct                    | 1213 → retry | 1020 → retry                                  |
| `fence` / `complete` vs reclaim of the attempt      | correct | correct                    | correct      | 1020 → retry                                  |

## Performance

PostgreSQL spike harness: the adapter's statements in raw SQL, 8 connections, rotated rounds, PostgreSQL 14, retries of 5 attempts with 5–50 ms jitter. Treat differences under about 10% as noise. Earlier rounds (3 rounds) measured completion and fan-in; later rounds (2 rounds of 6 s) measured acquisition and attach.

Completion and fan-in, at READ COMMITTED (ops/s · WAL bytes per op):

| Scenario                              | Today       | This design |
| ------------------------------------- | ----------- | ----------- |
| Chain completion, no dependents       | 3,762 · 627 | 5,083 · 622 |
| Fan-in, 200 dependents × 16 blockers  | 2,588 · 745 | 3,294 · 848 |
| Barrier, 2000 dependents × 8 blockers | 78 · 255 k  | 77 · 412 k  |

At REPEATABLE READ, fan-in ran at 3,201 ops/s · 847 B, where today's statements are incorrect.

Acquisition: 8 workers on one hot job type, `LIMIT 10`, each batch completed right away. Every worker renews its lease every 50 ms, and a producer inserts 20 jobs every 5 ms.

| Level | Worker guard     | Jobs/s        | Retried acquisitions | Retries exhausted (per 6 s) | Lease renewal retries (per 6 s) |
| ----- | ---------------- | ------------- | -------------------- | --------------------------- | ------------------------------- |
| RC    | `FOR KEY SHARE`  | 23,200–24,000 | 0%                   | 0                           | 0                               |
| RC    | worker-row write | 23,900–24,100 | 0%                   | 0                           | 0                               |
| RR    | `FOR KEY SHARE`  | 11,400–11,700 | 19%                  | 0–1                         | 0                               |
| RR    | worker-row write | 10,900–11,200 | 20%                  | 0                           | 35–49                           |
| SER   | `FOR KEY SHARE`  | 6,500–6,800   | 38–40%               | 42–56                       | 52–55                           |
| SER   | worker-row write | 5,200–5,400   | 48–52%               | 52–54                       | 97–132                          |

Attach, as core issues it: `lockBlockerChains`, `createJobs`, then a single-statement `addJobsBlockers` that writes the flag and the counter. Hot: every transaction attaches a new dependent to the same 16 running blockers. Cold: every transaction attaches to 16 blockers no one else touches.

| Scenario | Level | Flag write    | Ops/s       | Retried ops | Retries exhausted | WAL B/op      |
| -------- | ----- | ------------- | ----------- | ----------- | ----------------- | ------------- |
| Hot      | RC    | conditional   | 684–694     | 0%          | 0%                | 5,210–5,268   |
| Hot      | RC    | unconditional | 659–662     | 0%          | 0%                | 6,681–6,720   |
| Hot      | RR    | unconditional | 519–526     | 50%         | 3.4–3.5%          | 6,596–6,614   |
| Hot      | SER   | unconditional | 498–512     | 50–53%      | 3.4–3.8%          | 6,585–6,609   |
| Cold     | RC    | conditional   | 2,247–2,294 | 0%          | 0%                | 9,987–9,991   |
| Cold     | RC    | unconditional | 2,279–2,283 | 0%          | 0%                | 11,053–12,222 |
| Cold     | RR    | unconditional | 2,282–2,290 | 0%          | 0%                | 12,500        |
| Cold     | SER   | unconditional | 484–510     | 51–54%      | 4.2–4.7%          | 8,661–9,511   |

- Completions without dependents gain about 35% (one statement instead of two); fan-in gains about 25% (no `NOT EXISTS` scan). A barrier writes every dependent on every completion (+60% WAL, HOT), at unchanged throughput.
- The worker-row write costs nothing measurable at READ COMMITTED or REPEATABLE READ. At SERIALIZABLE it costs about 20% of acquisition throughput. It doubles lease-renewal retries at the stricter levels, though no renewal exhausted its retries.
- Acquisition at the stricter levels is expensive whatever the guard. REPEATABLE READ halves throughput: about one acquisition in five hits 40001 on a row another worker acquired after the statement's snapshot. SERIALIZABLE cuts throughput by about 75% and exhausts the 5-attempt retry several times a second, which sends workers into recovery backoff. This cost falls only on users who choose those levels for Queuert's pool.
- The unconditional flag write costs about 4% of attach throughput to hot blockers at READ COMMITTED (within noise) and about 28% more WAL per attach. On cold blockers both variants write the same rows, because every head starts at `false`. Throughput is the same; the 10–22% WAL gap between them is unexplained and may be checkpoint full-page writes.
- At REPEATABLE READ, hot-blocker attaches lose about 25% of throughput and half of them retry; 3.5% of transactions exhaust 5 retries and reach the caller. The write that makes REPEATABLE READ correct is what conflicts, so no correct variant avoids it. Cold attaches at REPEATABLE READ run like READ COMMITTED.
- At SERIALIZABLE, about half of all attach transactions retry and about 4% exhaust their retries, even on uncontended blockers: SSI predicate-lock conflicts on `job_blocker` and index pages. This is correct but slow; it is documented, not addressed here.

On MySQL, the cost of the stricter levels is acquisition's gap locks on a drained queue (see [Acquisition](#acquisition-startjobattempts)).

## Migration (`002_blocker_counters`)

`002_blocker_counters` is not released yet. It already adds `has_dependents` with its backfill, the `chain_has_dependents_idx` index that `listChains` uses for `independent: false`, and the move from `schema_fence_v1` to `schema_fence_v2`. This design extends the same migration before it ships, on PostgreSQL and MySQL; there is no `003` and no `schema_fence_v3`.

On PostgreSQL, one breaking transactional migration with a `SET LOCAL lock_timeout` so it gives up rather than queue behind running workers:

1. Add `has_dependents` and `blockers_remaining` (constant defaults: no table rewrite).
2. Set `has_dependents = true` on every head job referenced by a `job_blocker` row.
3. Set `blockers_remaining` on every `blocked` job to the number of its `job_blocker` rows whose blocker head's `chain_status` is distinct from `completed` (the same predicate as today's recompute, so a missing head counts as incomplete).
4. Move `blocked` jobs whose `blockers_remaining` is zero to `pending` with `scheduled_at = GREATEST(scheduled_at, now())`. These are dependents a previous release left stuck; none exist on a database that only ever ran at READ COMMITTED.
5. Move `running` jobs whose `attempt_by` matches no `worker` row to `pending`, with `attempt_at`, `attempt_by` and `attempt_token` cleared. These are attempts orphaned by the acquisition race; none exist on a database that only ever ran at READ COMMITTED.
6. Create `chain_has_dependents_idx`, create `schema_fence_v2` and drop `schema_fence_v1`.

On MySQL the migration stays non-transactional, with every step rerunnable: add the columns and the index if missing, backfill `has_dependents` and `blockers_remaining`, move stuck dependents to `pending`, and swap the fences.

No older process may write alongside a process after `002`:

- An older attacher inserts `job_blocker` rows without setting `has_dependents` or `blockers_remaining`. A new completer then skips `unblockJobs` (the dependent stays `blocked`), or decrements a counter that was never set and never reaches zero.
- An older completer unblocks through the recompute, which stays correct but leaves `blockers_remaining` stale on jobs it moves to `pending`. That is harmless, because the counter is read only on `blocked` jobs.

Dropping `schema_fence_v1` makes every write of 0.18 fail with `SchemaFencedError`, so those processes cannot corrupt state. A 0.17 PostgreSQL or SQLite process references no fence table, so the release still requires every 0.17 process to stop before `002` runs.

## API

- State adapter contract: each `completeJobs` result carries `hasDependents: boolean` (shipped with `002_blocker_counters`). `false` guarantees that no `job_blocker` row references the completed chain; `true` may outlive the rows. `unblockJobs` is documented as called only when it is `true`. This is a breaking change for custom state adapters.
- State adapter contract: `withTransaction` may call `fn` more than once, and core keeps every callback it passes free of side effects outside the database.
- Providers: the PostgreSQL and MySQL providers no longer pin READ COMMITTED. Their TSDoc, the adapters' TSDoc and the attempt handler's TSDoc stop saying that only READ COMMITTED is supported.
- No change to the client, worker or processor API.
- Docs: the "Isolation level" section of the PostgreSQL integration page states the following:
  - READ COMMITTED, REPEATABLE READ and SERIALIZABLE are supported for every transaction, as a session default or per transaction, including mixed levels.
  - Migrations always run at READ COMMITTED.
  - Transactions passed to Queuert can raise 40001/40P01 at the stricter levels and should be retried by the caller, with fresh `txHooks` or inside `txHooks.retryBoundary`.
  - Queuert retries its own.
  - Contention costs: attaching many dependents to one blocker, and acquisition with many workers at the stricter levels, with the READ COMMITTED pool default as the way out.
- Docs: the "Isolation level" section of the MySQL integration page states:
  - READ COMMITTED, REPEATABLE READ and SERIALIZABLE are supported for every transaction, as a session default or per transaction, including mixed levels.
  - Migrations always run at READ COMMITTED.
  - At the stricter levels, 1213 (and 1020 on MariaDB ≥ 11.6) can fail a call; retry it with fresh `txHooks` or inside `txHooks.retryBoundary`. Queuert retries its own.
  - Acquisition at RR and SERIALIZABLE takes gap locks that stall inserts on a drained queue, with the READ COMMITTED pool default as the way out.
  - On MariaDB ≥ 11.6, RC for transactions passed to Queuert, or `innodb_snapshot_isolation=OFF`, avoids 1020 on benign interleavings.
- Docs: the state provider component and the example descriptions stop saying every transaction runs at READ COMMITTED.
- The schema reference lists the two columns.

## Tests

Tests are split by what can observe them. Contract behavior goes into the shared state adapter conformance suite, which runs against every adapter. Behavior that needs raw SQL or a choice of isolation level goes into each adapter's own suite.

**Shared conformance (core `state-adapter-cases`, all adapters)**

- `complete-jobs`: `hasDependents` is `false` for a chain no `job_blocker` row ever referenced, and `true` for a referenced chain, both when the head completes a single-job chain and when the tail completes a multi-job chain.
- `unblock-jobs`: a dependent that lists one blocker chain at two positions unblocks when that chain completes. A dependent with three blockers stays `blocked` until the last one completes, whatever the completion order.
- `add-jobs-blockers`: a completion that waits on an attach's head lock unblocks the attached dependent. This is the reverse order of the existing "completed while it waited on the head lock" case.
- `start-job-attempt`: a reclaim that waits on an acquisition's worker-row lock sees the job the acquisition claimed. This is the reverse order of the existing "a claim waiting on a transaction that locks and deletes the worker claims nothing" case.
- New optional fixture field `isolationVariants`: a list of `{ name, stateAdapter, isRetryableError }` adapters over the same store with different isolation levels. Cases that script a lock-wait interleaving run once per ordered pair of variants, and retry the side that raises a retryable error. This covers the "while it waited on the head lock" family in `add-jobs-blockers`, `delete-chains` and `start-job-attempt`, the two new interleavings above, and the concurrent fan-in case in `unblock-jobs`. Adapters without variants (SQLite, in-process) run the single pair as today.
- Provider conformance: the PostgreSQL and MySQL cases "withTransaction opens transactions at READ COMMITTED" become "withTransaction opens transactions at the session default".

**PostgreSQL suite (`packages/postgres/src/specs`)**

Kept separate from the shared suite because it needs raw SQL and per-connection levels. It is written so that a later PostgreSQL-compatible adapter can run it too.

- Level matrix: the conformance spec passes `isolationVariants` built from three pools whose `default_transaction_isolation` is `read committed`, `repeatable read` and `serializable` (nine ordered pairs per interleaving case).
- Counter invariant: the conformance context's `createStateAdapter` first checks two things, then truncates:
  - every `blocked` job's `blockers_remaining` equals its recomputed count;
  - every head that a `job_blocker` row references has `has_dependents`.
- Fan-in under load: 200 dependents × 16 blockers completed by 8 connections at REPEATABLE READ and at SERIALIZABLE leave no dependent `blocked`. Concurrent multi-blocker attaches raise no 40P01 at READ COMMITTED.
- Retry: a provider that injects 40001 or 40P01 shows four things:
  - `withTransaction` calls `fn` again;
  - an autocommit statement re-executes;
  - both throw after the fifth attempt;
  - statements on a caller's `txCtx` are never retried.
- Processing: the `process`, `worker` and `blocker-chains` end-to-end groups run again with the test pool's `default_transaction_isolation` set to `repeatable read` and to `serializable`.
- Migrations, with the session default at `repeatable read` and at `serializable`:
  - parallel deployments through the existing spawner all succeed, exactly one applies each migration, and none fails with 40001;
  - `current_setting('transaction_isolation')` inside a migration reports `read committed`.
- Migration `002_blocker_counters`: a database migrated to `001` and seeded with raw inserts. The seed contains:
  - blocked dependents waiting on mixed `running`/`completed` blockers
  - duplicate blocker chains
  - a stuck dependent whose blockers all completed
  - a `running` job whose worker row is missing

  After `002` the counters match the recompute, and both the stuck dependent and the orphaned job are `pending`.

**MySQL suite (`packages/mysql/src/specs-mysql2`)**

On MySQL 8.4 and MariaDB 11.4, plus MariaDB 11.8 for `innodb_snapshot_isolation`:

- Level matrix: the conformance spec passes `isolationVariants` built from pools whose session default is `READ-COMMITTED`, `REPEATABLE-READ` and `SERIALIZABLE`. MariaDB 11.8 runs it twice, with `innodb_snapshot_isolation` ON and OFF.
- Races: the isolation spec runs its races at RR and SERIALIZABLE on both sides, mixed. Each ends with the dependent `pending`, retrying the side that raised 1213 or 1020.
- Migration `002_blocker_counters`: a database at `001` with blocked dependents on mixed running and completed blockers ends with counters that match the recompute.
- Fan-in under load: 200 dependents × 16 blockers completed by 8 connections at RR and at SERIALIZABLE leave no dependent `blocked`, and `blockers_remaining` equals its recompute.
- Retry: a provider that injects 1213 or 1020 shows that `withTransaction` calls `fn` again, an autocommit statement re-executes, both throw after the fifth attempt, and statements on a caller's `txCtx` are never retried.
- Queuert-owned transactions report the session default in `information_schema.innodb_trx`; migrations report `READ COMMITTED` under a `SERIALIZABLE` session.
- Processing: the end-to-end suite runs again with the test pool's session default at `REPEATABLE-READ` and at `SERIALIZABLE`, on MySQL 8.4 and MariaDB 11.4.

**SQLite and in-process**

No suite of their own. Both have a single effective isolation level and no new SQL-level invariant, so the shared conformance cases cover their contract change (`hasDependents`).

## Related designs

- **Chain table** (`design/chain-table.md`): moves `has_dependents` from the head job row to the `chain` row on both adapters; `blockers_remaining` stays on `job`. Its write-based bookkeeping section is this design applied to the split schema.
- **Unbounded blockers** (`design/unbounded-blockers.md`): its `job_blocker.blocked` flip has to follow the same write-based rule, and on MySQL must be a current-read write.
- **MongoDB adapter** (`design/mongodb-adapter.md`): applies the same rule at snapshot isolation.
