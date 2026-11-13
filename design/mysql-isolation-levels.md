# MySQL / MariaDB isolation levels

Make the MySQL / MariaDB state adapter correct when a transaction passed to Queuert (client methods, `complete`, `fence`) runs at REPEATABLE READ or SERIALIZABLE, as `design/pg-isolation-levels.md` does for PostgreSQL. REPEATABLE READ is InnoDB's default, so most users pass it in without knowing; today the docs ask them to open those transactions at READ COMMITTED.

Today the adapter keeps blockers the way PostgreSQL does at READ COMMITTED: `unblockJobs` locks the blocked dependents and rechecks `job_blocker` for an incomplete blocker. That is correct at RC and leaves dependents stuck at RR (see [Races](#races)). The provider already opens the transactions Queuert owns at READ COMMITTED. What is left:

- Add the counter-based blocker bookkeeping from `design/pg-isolation-levels.md` in a migration, with every read that drives a write a current read (see [Blocker counters](#blocker-counters)).
- Run the races and the end-to-end suites at RR and SERIALIZABLE on every server, and fix what they find.
- Handle MariaDB's snapshot-isolation error (1020) and deadlocks (1213) in the work Queuert runs itself.
- Take the `hasDependents` contract and the `isolationVariants` conformance fixture from `design/pg-isolation-levels.md` once they land.
- Rewrite the "Isolation level" section of the MySQL integration page.

Claims marked _(spike)_ were verified against MySQL 8.0.46, MySQL 8.4.13, MariaDB 10.11.19, MariaDB 11.4.13 and MariaDB 11.8.9 with mysql2 3.24, by a spike run before the adapter was written. The adapter itself has been tested at READ COMMITTED only.

## Problem

### What InnoDB does differently from PostgreSQL

Each fact below was verified on MySQL 8.4, MariaDB 11.4 and MariaDB 11.8 _(spike)_:

- **Current reads see past the snapshot at any level.** `FOR UPDATE`, `LOCK IN SHARE MODE`, `UPDATE` and `DELETE` read the latest committed version, including phantom rows. A plain `SELECT` at RR reads a snapshot fixed at the transaction's first consistent read, not at `START TRANSACTION`. With the default settings, a write over a row that changed after the snapshot raises no error. PostgreSQL's 40001 has no counterpart.
- **A subquery under `SELECT … FOR UPDATE` is a snapshot read.** A subquery inside an `UPDATE` is a current read. In `SELECT … WHERE id IN (SELECT job_id FROM job_blocker …) FOR UPDATE`, the subquery missed a `job_blocker` row committed after the snapshot.
- **RR takes next-key and gap locks on locking range scans.** RC takes none, apart from duplicate checks.
- **SERIALIZABLE turns plain `SELECT`s into share-locking reads** inside a transaction. This masks plain-read bugs, at the cost of more lock waits and deadlocks.
- **MariaDB `innodb_snapshot_isolation`** defaults ON from 11.6 and is OFF on 11.4. While ON, at RR and SERIALIZABLE, a locking read or write of a row changed after the snapshot raises **1020** and rolls back the whole transaction. It does not fix plain-read bugs.
- **1213** (deadlock) rolls back the whole transaction, and the connection then continues in autocommit. **1205** (lock wait timeout) rolls back only the statement, unless the server runs with `innodb_rollback_on_timeout`.

### Races

The blocker races from `design/pg-isolation-levels.md`, run with two connections and controlled interleavings. Every transaction first runs a plain `SELECT`, which fixes its snapshot. "Stuck" means the dependent stayed `blocked` with no incomplete blockers; "retry" means one side raised the listed error and a retry succeeded _(spike)_.

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

### Blocker counters

`002_blocker_counters` adds `has_dependents` and `blockers_remaining` to `job`, with the semantics of `design/pg-isolation-levels.md`, and backfills them from `job_blocker`. The rule stays the same: every invariant that pairs a read in one transaction with a write in another must be a write-write conflict on a shared row. InnoDB adds one more: every read that drives such a write is a current read.

- **Attach** locks the blocker heads in id order with a driven lock (`JSON_TABLE` `STRAIGHT_JOIN` `job` `FORCE INDEX (PRIMARY)`), sets `has_dependents` on heads where it is false, inserts the `job_blocker` rows, and adds to each dependent's `blockers_remaining` the number of its locked heads that are still running.
- **Completion** reads `has_dependents` from the head row it just updated, and skips `unblockJobs` when it is false.
- **`unblockJobs`** share-locks the `job_blocker` rows of the completed chain (a current read), then decrements `blockers_remaining` on those dependents in id order in one `UPDATE`, setting `pending` where it reaches zero. Every expression uses old values and `blockers_remaining` is assigned last, so the statement is correct under both left-to-right and simultaneous assignment.

### User transactions

Transactions passed to Queuert run at the user's level. Expected behavior, to be confirmed by the tests below:

- **RR:** correct. On MySQL and MariaDB ≤ 11.5 there are no serialization errors: concurrent writers wait and then update the latest version. Queuert's statements are point lookups by primary key, which take record locks only; the user's own locking range reads take gap locks as usual.
- **SERIALIZABLE:** correct, with more lock waits. Plain reads become share locks, so expect 1213 under contention.
- **MariaDB ≥ 11.6 at RR or SERIALIZABLE with `innodb_snapshot_isolation=ON`:** correct, but 1020 also appears on benign interleavings, such as a completion committing inside an attacher's snapshot. Fan-in onto one dependent averaged about 5 retries per completion _(spike)_.

A 1213 or 1020 fails the attempt or the client call like any other error, and the job is rescheduled with backoff. Retrying a client call is the caller's concern, with fresh `txHooks` or inside `txHooks.retryBoundary`, as on PostgreSQL. A 1205 leaves the transaction open with a statement missing; the rule that such a transaction must be rolled back already applies at RC.

### Queuert's own transactions stay at READ COMMITTED

Unlike PostgreSQL, the transactions Queuert opens keep their READ COMMITTED pin. This is about liveness, not correctness: at RR, acquisition's locking scans take gap locks _(spike)_:

- An `INSERT` of a new due job blocked until 1205 whenever a claim scan reached the end of the pending range, which is the normal state of a drained queue.
- On a drained queue at RR, MariaDB dropped from about 770 to about 97 completions/s, with 100–140 deadlocks in 10 s and producer p99 rising from 4 ms to about 200 ms. MySQL hit 215 deadlocks.

Lease renewals and other autocommit statements run at the session default. On a session at RR they are single-row primary-key writes, so no gap locks; the tests confirm that a pool whose default is RR or SERIALIZABLE keeps the worker running.

### Retries in Queuert's own work

The adapter retries 1213 and 1020 for the work Queuert runs itself, with the bounds from `design/pg-isolation-levels.md` (5 attempts, 5–50 ms jittered delay): `withTransaction` rolls back and calls `fn` again, and autocommit statements re-execute. At RC 1020 cannot occur, but a pool at a stricter session default can still produce 1213. Statements on a caller's `txCtx` are never retried.

### Migrations

Migrations already run as non-transactional DDL with a table lease, outside any snapshot that matters, and data statements are rerunnable. The migration store pins its connection to READ COMMITTED so a backfill never reads a snapshot from before a metadata-lock wait.

## Behavior by isolation level

Levels apply to either side of each race, mixed or not. Expected values, to be filled from the tests:

| Race                                                | RC      | RR (MySQL, MariaDB ≤ 11.5) | SER          | MariaDB ≥ 11.6, RR/SER, snapshot isolation ON |
| --------------------------------------------------- | ------- | -------------------------- | ------------ | --------------------------------------------- |
| Attach vs completion of the blocker (any order)     | correct | correct                    | correct      | 1020 → retry                                  |
| Attach vs deletion of the blocker chain             | correct | correct                    | correct      | 1020 → retry                                  |
| Two blockers of one dependent complete concurrently | correct | correct                    | 1213 → retry | 1020 → retry                                  |
| `fence` / `complete` vs reclaim of the attempt      | correct | correct                    | correct      | 1020 → retry                                  |

## API

- No change to the client, worker or processor API.
- Takes the state adapter contract changes from `design/pg-isolation-levels.md` (`hasDependents`, `withTransaction` may call `fn` more than once). The counters arrive in `002_blocker_counters`.
- Docs: the "Isolation level" section of the MySQL integration page states:
  - READ COMMITTED, REPEATABLE READ and SERIALIZABLE are supported for transactions passed to Queuert, as a session default or per transaction.
  - Transactions Queuert opens always run at READ COMMITTED, and why.
  - At the stricter levels, 1213 (and 1020 on MariaDB ≥ 11.6) can fail a call; retry it with fresh `txHooks` or inside `txHooks.retryBoundary`.
  - On MariaDB ≥ 11.6, RC for transactions passed to Queuert, or `innodb_snapshot_isolation=OFF`, avoids 1020 on benign interleavings.

## Tests

In `packages/mysql/src/specs-mysql2`, on MySQL 8.4 and MariaDB 11.4, plus MariaDB 11.8 for `innodb_snapshot_isolation`:

- **Level matrix:** the conformance spec passes `isolationVariants` built from pools whose session default is `READ-COMMITTED`, `REPEATABLE-READ` and `SERIALIZABLE`. MariaDB 11.8 runs it twice, with `innodb_snapshot_isolation` ON and OFF.
- **Races:** the isolation spec runs its races at RR and SERIALIZABLE on both sides, mixed. Each ends with the dependent `pending`, retrying the side that raised 1213 or 1020.
- **Migration `002`:** a database at `001` with blocked dependents on mixed running and completed blockers ends with counters that match the recompute.
- **Fan-in under load:** 200 dependents × 16 blockers completed by 8 connections at RR and at SERIALIZABLE leave no dependent `blocked`, and `blockers_remaining` equals its recompute.
- **Retry:** a provider that injects 1213 or 1020 shows that `withTransaction` calls `fn` again, an autocommit statement re-executes, both throw after the fifth attempt, and statements on a caller's `txCtx` are never retried.
- **Queuert-owned transactions** still report `READ COMMITTED` in `information_schema.innodb_trx` under a `SERIALIZABLE` session.
- **Processing:** the end-to-end suite runs again with the test pool's session default at `REPEATABLE-READ` and at `SERIALIZABLE`, on MySQL 8.4 and MariaDB 11.4.

## Related designs

- **PostgreSQL isolation levels** (`design/pg-isolation-levels.md`): supplies the counter semantics, the `hasDependents` contract change, the `isolationVariants` fixture and the retry bounds. This task follows it.
- **Chain table** (`design/chain-table.md`): moves `has_dependents` to the chain row; this adapter follows in the same release.
- **Unbounded blockers** (`design/unbounded-blockers.md`): its `job_blocker.blocked` flip must be a current-read write here as well.
