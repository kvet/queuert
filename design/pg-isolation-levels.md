# PostgreSQL isolation levels

Make the PostgreSQL state adapter correct when any transaction that touches Queuert's tables runs at READ COMMITTED, REPEATABLE READ or SERIALIZABLE, including mixes of levels across transactions. The design rests on three changes:

- Every cross-transaction invariant becomes a write-write conflict on a shared row: counter-based blocker bookkeeping (`has_dependents`, `blockers_remaining`) and a write on the worker row during acquisition.
- The adapter retries serialization failures in the work Queuert runs itself.
- Migrations are pinned to READ COMMITTED. Every other transaction runs at the level the user's connection or transaction chooses.

## Problem

Three invariants pair a read in one transaction with a write in another, and only a row **lock** links the two:

- **Attach vs completion of the blocker.** `addJobsBlockers` locks the blocker's head job and reads `chain_status`; the completer's `unblockJobs` reads `job_blocker` to find dependents.
- **Two blockers of one dependent completing concurrently.** `unblockJobs` locks the blocked dependents (`lockBlockedJobs`), then recomputes `NOT EXISTS (incomplete blocker)` in a second statement.
- **Acquisition vs reclaim of an expired worker.** `startJobAttempts` takes `FOR KEY SHARE` on the worker row and writes `attempt_by` on the acquired jobs; the reclaimer locks the worker row `FOR UPDATE`, lists the worker's running jobs, reschedules them and deletes the worker.

All three rely on READ COMMITTED taking a fresh snapshot per statement after a lock wait. Under REPEATABLE READ the snapshot is fixed at the transaction's first statement. If the other transaction only _locked_ a row and never wrote it, no serialization failure is raised, so both sides commit:

- In the blocker races, the dependent stays `blocked` forever.
- In the worker race, the reclaimer misses a job acquired by a worker whose acquisition statement started just before its lease expired. The reclaimer then deletes the worker row. If that process dies before settling the attempt, the job stays `running` with an `attempt_by` that no worker row matches. Nothing reclaims it, and no foreign key on `attempt_by` catches it.

SERIALIZABLE detects these write skews only when **both** sides are SERIALIZABLE. Levels can differ per transaction (`BEGIN ISOLATION LEVEL …`), so the design cannot assume a uniform level, and a write made conditional on the writer's own level does not help.

Two more problems come from the session default:

- Acquisition (`startJobAttempts`, `getStartAttemptDelayMs`) runs as autocommit statements. At REPEATABLE READ, `FOR UPDATE … SKIP LOCKED` raises 40001 on a row that another worker acquired and committed after the statement's snapshot, because SKIP LOCKED only skips rows that are still locked. The batch is lost and the worker enters recovery backoff.
- Migrations take their advisory lock in the transaction's first statement, so at REPEATABLE READ the snapshot is fixed before the wait. Three failures follow (see Migrations).

Raw-SQL spikes (PostgreSQL 14, two-connection interleavings) reproduced the lock-only races. The first spike ran both sides at the same level; the second set each side's level independently:

| Race (today's statements)                               | Broken                                                  |
| ------------------------------------------------------- | ------------------------------------------------------- |
| Attach commits inside the completer's snapshot          | RR (same level on both sides)                           |
| Completer waits on the attacher's head lock             | RR (same level on both sides)                           |
| Two blockers of one dependent complete concurrently     | RR (same level on both sides)                           |
| Attach with `has_dependents` already true vs completion | attacher/completer RC/RR, RC/SER, SER/RR                |
| Acquisition (`FOR KEY SHARE`) vs reclaim: job orphaned  | acquirer/reclaimer RC/RR, RC/SER, RR/RR, RR/SER, SER/RR |

Under load (200 dependents × 16 blockers completed by 8 connections at REPEATABLE READ), 6–8 dependents were left `blocked`. With the changes below, all nine level pairs of the last two races end correctly, with one 40001 retry where a side is REPEATABLE READ or SERIALIZABLE. The worker-owned transactions (own-job reclaim vs own `complete`, stop vs reclaim as expired) were correct in all nine pairs already.

## Design

Rule: **every invariant that pairs a read in one transaction with a write in another must be a write-write conflict on a shared row, whatever level each side runs at.** READ COMMITTED then waits and re-reads the latest version (EvalPlanQual); REPEATABLE READ and SERIALIZABLE raise 40001. The caller retries: the user for their own transactions, the adapter for Queuert's.

### Schema

On `job`:

- `has_dependents boolean NOT NULL DEFAULT false` — meaningful on head jobs: at least one `job_blocker` row references this chain. It is never cleared, so `true` can outlive the rows.
- `blockers_remaining integer NOT NULL DEFAULT 0` — meaningful on `blocked` jobs: the number of this job's `job_blocker` rows whose blocker chain is not `completed`. Duplicate blocker chains at different `index` positions count once per row.

Neither column is indexed, so writes that change only these columns can be HOT updates. The `worker` table needs no change.

### Attach (`addJobsBlockers`)

1. Lock the blocker head jobs in id order (`ORDER BY h.id FOR UPDATE`), as today. The lock stays a `SELECT … FOR UPDATE`: a bare `UPDATE` cannot order its row locks, and in the spike it deadlocked on 119 of 2000 concurrent multi-blocker attaches.
2. Write `has_dependents = true` on **every** locked head, including heads where it is already `true`. The conflict has to exist whenever the _completer_ might be at REPEATABLE READ or SERIALIZABLE, and the attacher cannot know the completer's level.
3. Insert the `job_blocker` rows.
4. Set the dependent's `blockers_remaining` to the number of its `job_blocker` rows whose locked head is `running`, and its status to `blocked` when that number is above zero.

All four stay one statement, as `addJobsBlockers` is today.

The same write covers `deleteChains`. A deletion whose snapshot predates a committed attach to the chain raises 40001 when it locks the head, instead of reading `job_blocker` from a stale snapshot and deleting a chain that is still referenced.

### Completion (`completeJobs` + `unblockJobs`)

- `completeJobs` returns the chain head's `has_dependents` as `hasDependents` on each result, taken from the `UPDATE … RETURNING` that completes the chain (the head itself for a single-job chain, `head_done` otherwise). After a lock wait this is the latest version.
- Core skips `unblockJobs` when `hasDependents` is `false`. This replaces `lockBlockedJobs`' `EXISTS` round trip on every chain completion without dependents.
- `unblockJobs` is one statement:
  1. Lock, in id order (`MATERIALIZED` CTE, `FOR UPDATE`), the dependents that are `blocked` and have `job_blocker` rows for the completed chain.
  2. Decrement each one's `blockers_remaining` by its row count for that chain.
  3. Move it to `pending` with `scheduled_at = GREATEST(scheduled_at, statement_timestamp())` when the result reaches zero.

  Every completion writes every dependent it counts down, so concurrent completers of one dependent always conflict on its row. The `NOT EXISTS` scan over all of a dependent's blockers goes away.

- `unblockJobs` keeps returning one `StateDependentJob` per `job_blocker` row (for blocker spans), as today.

### Acquisition (`startJobAttempts`)

The `live_worker` CTE changes from `SELECT … FOR KEY SHARE` to a write:

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

### Serialization failures in Queuert's own work

The PostgreSQL adapter retries 40001 (`serialization_failure`) and 40P01 (`deadlock_detected`) for the work Queuert runs itself:

- `withTransaction` (worker registration, own-job reclaim, expired-worker reclaim, stop): rolls back and calls `fn` again.
- Autocommit statements issued without a `txCtx` (acquisition, `getStartAttemptDelayMs`, lease renewal, the fallback reschedule, the reclaim candidate listing): re-executes the statement.

Retries are bounded (5 attempts) with a short jittered delay (5–50 ms). When the attempts run out, the error is thrown, and the worker treats it as a transient database error, as today. Every retried unit is safe to re-run: the `withTransaction` callbacks in core only read and write the database, and their notifications and observability events run after commit.

The adapter sets no isolation level on these transactions or statements. They run at the session default, or at the level the provider's connection uses. A user who wants a stricter level for their own code without its acquisition cost can give the pool Queuert uses a READ COMMITTED default and raise the level per transaction in their own code.

### Migrations

Migrations always run at READ COMMITTED:

- The migration store's `runInTransaction` and `initialize` issue `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` before the advisory lock.
- The lease statements (`acquireMigrationLock`, `extendMigrationLock`, `releaseMigrationLock`) run inside a READ COMMITTED transaction.

Migrations touch only Queuert's tables and run once per deploy, so the pin takes nothing from users who run everything else at a stricter level. Without the pin, the spike showed three failures at REPEATABLE READ and SERIALIZABLE:

- **Lease acquisition.** When several replicas boot together, each one's `INSERT … ON CONFLICT DO UPDATE` collides with an insert that committed after its own snapshot, and raises 40001 instead of returning "not acquired". The migrator's poll loop does not catch it, so `migrateToLatest` throws on every replica except the one that inserted the row.
- **Advisory lock.** A run that waits on another run of the same migration reads `migration` without the other run's record. It re-executes the statements and then fails with 40001 when recording. Nothing is applied twice, but the run errors. This happens only after the lease was lost.
- **Backfills.** A data statement after an `ALTER TABLE` that waited for an open writer uses the snapshot from before the wait and silently skips the writer's rows.

### User transactions

A 40001 or 40P01 raised in a transaction passed to `complete` fails the attempt like any other error, and the job is rescheduled with backoff. Client methods throw it to the caller. Retrying is the caller's concern and is documented. Different user transactions may run at different levels.

A caller that retries a transaction needs fresh `transactionHooks` for each try, because a `complete` that succeeded in a rolled-back try refuses to run again with the same hooks. That is a separate task (TODO: transactionHooks reset for REPEATABLE READ and SERIALIZABLE).

### SQLite and in-process

SQLite serializes writers and the in-process adapter serializes through its lock, so neither has these races. Both keep recomputing readiness and take no migration. They only implement the contract changes:

- `completeJobs` returns `hasDependents` (an `EXISTS` over `job_blocker` for the completed chain).
- `withTransaction` keeps calling `fn` once.

## Behavior by isolation level

Levels apply to either side of each race, mixed or not.

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

## Performance

Spike harness: the adapter's statements in raw SQL, 8 connections, rotated rounds, PostgreSQL 14, retries of 5 attempts with 5–50 ms jitter. Treat differences under about 10% as noise. Earlier rounds (3 rounds) measured completion and fan-in; later rounds (2 rounds of 6 s) measured acquisition and attach.

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

## Migration (`003_blocker_counters`)

One transactional migration after `002_worker_liveness`, with `SET LOCAL lock_timeout` as in `002`:

1. Add `has_dependents` and `blockers_remaining` (constant defaults: no table rewrite).
2. Set `has_dependents = true` on every head job referenced by a `job_blocker` row.
3. Set `blockers_remaining` on every `blocked` job to the number of its `job_blocker` rows whose blocker head's `chain_status` is distinct from `completed` (the same predicate as today's recompute, so a missing head counts as incomplete).
4. Move `blocked` jobs whose `blockers_remaining` is zero to `pending` with `scheduled_at = GREATEST(scheduled_at, now())`. These are dependents a previous release left stuck; none exist on a database that only ever ran at READ COMMITTED.
5. Move `running` jobs whose `attempt_by` matches no `worker` row to `pending`, with `attempt_at`, `attempt_by` and `attempt_token` cleared. These are attempts orphaned by the acquisition race; none exist on a database that only ever ran at READ COMMITTED.

`002_worker_liveness` shipped in 0.17, so `003` needs its own upgrade rule. A 0.17 process must not run alongside a process after `003`:

- A 0.17 attacher inserts `job_blocker` rows without setting `has_dependents` or `blockers_remaining`. A new completer then skips `unblockJobs` (the dependent stays `blocked`), or decrements a counter that was never set and unblocks the dependent before its other blockers complete.
- A 0.17 completer unblocks through the recompute, which stays correct but leaves `blockers_remaining` stale on jobs it moves to `pending`. That is harmless, because the counter is read only on `blocked` jobs.

The release therefore requires every 0.17 process to stop before `003` runs, and documents this alongside the existing rule that pre-0.17 processes must stop before the next release.

## API

- State adapter contract: each `completeJobs` result carries `hasDependents: boolean`. `false` guarantees that no `job_blocker` row references the completed chain; `true` may outlive the rows. `unblockJobs` is documented as called only when it is `true`. This is a breaking change for custom state adapters.
- State adapter contract: `withTransaction` may call `fn` more than once, and core keeps every callback it passes free of side effects outside the database.
- No change to the client, worker or processor API.
- Docs: the "Isolation level" section of the PostgreSQL integration page states the following:
  - READ COMMITTED, REPEATABLE READ and SERIALIZABLE are supported for every transaction, as a session default or per transaction, including mixed levels.
  - Migrations always run at READ COMMITTED.
  - Transactions passed to Queuert can raise 40001/40P01 at the stricter levels and should be retried by the caller, with fresh `transactionHooks`.
  - Queuert retries its own.
  - Contention costs: attaching many dependents to one blocker, and acquisition with many workers at the stricter levels, with the READ COMMITTED pool default as the way out.
- The schema reference lists the two columns.

## Tests

Tests are split by what can observe them. Contract behavior goes into the shared state adapter conformance suite, which runs against every adapter. Behavior that needs raw SQL or a choice of isolation level goes into a PostgreSQL suite.

**Shared conformance (core `state-adapter-cases`, all adapters)**

- `complete-jobs`: `hasDependents` is `false` for a chain no `job_blocker` row ever referenced, and `true` for a referenced chain, both when the head completes a single-job chain and when the tail completes a multi-job chain.
- `unblock-jobs`: a dependent that lists one blocker chain at two positions unblocks when that chain completes. A dependent with three blockers stays `blocked` until the last one completes, whatever the completion order.
- `add-jobs-blockers`: a completion that waits on an attach's head lock unblocks the attached dependent. This is the reverse order of the existing "completed while it waited on the head lock" case.
- `start-job-attempt`: a reclaim that waits on an acquisition's worker-row lock sees the job the acquisition claimed. This is the reverse order of the existing "a claim waiting on a transaction that locks and deletes the worker claims nothing" case.
- New optional fixture field `isolationVariants`: a list of `{ name, stateAdapter, isRetryableError }` adapters over the same store with different isolation levels. Cases that script a lock-wait interleaving run once per ordered pair of variants, and retry the side that raises a retryable error. This covers the "while it waited on the head lock" family in `add-jobs-blockers`, `delete-chains` and `start-job-attempt`, the two new interleavings above, and the concurrent fan-in case in `unblock-jobs`. Adapters without variants (SQLite, in-process) run the single pair as today.

**PostgreSQL suite (`packages/postgres/src/specs`)**

Kept separate from the shared suite because it needs raw SQL and per-connection levels. It is written so that a later PostgreSQL-compatible adapter can run it too.

- Level matrix: the conformance spec passes `isolationVariants` built from three pools whose `default_transaction_isolation` is `read committed`, `repeatable read` and `serializable` (nine ordered pairs per interleaving case).
- Counter invariant: the conformance fixture's `reset` first checks two things, then truncates:
  - every `blocked` job's `blockers_remaining` equals its recomputed count;
  - every head that a `job_blocker` row references has `has_dependents`.
- Fan-in under load: 200 dependents × 16 blockers completed by 8 connections at REPEATABLE READ and at SERIALIZABLE leave no dependent `blocked`. Concurrent multi-blocker attaches raise no 40P01 at READ COMMITTED.
- Retry: a provider that injects 40001 or 40P01 shows four things:
  - `withTransaction` calls `fn` again;
  - an autocommit statement re-executes;
  - both throw after the fifth attempt;
  - statements on a caller's `txCtx` are never retried.
- Processing: the `process`, `worker` and `blocker-chains` suites run again with the test pool's `default_transaction_isolation` set to `repeatable read` and to `serializable`.
- Migrations, with the session default at `repeatable read` and at `serializable`:
  - parallel deployments through the existing spawner all succeed, exactly one applies each migration, and none fails with 40001;
  - `current_setting('transaction_isolation')` inside a migration reports `read committed`.
- Migration `003`: a database migrated to `002` and seeded with raw inserts. The seed contains:
  - blocked dependents waiting on mixed `running`/`completed` blockers
  - duplicate blocker chains
  - a stuck dependent whose blockers all completed
  - a `running` job whose worker row is missing

  After `003` the counters match the recompute, and both the stuck dependent and the orphaned job are `pending`.

**SQLite and in-process**

No suite of their own. Both have a single effective isolation level and no new SQL-level invariant, so the shared conformance cases cover their contract change (`hasDependents`).

## Related designs

- **Chain table** (`design/chain-table.md`): moves `has_dependents` from the head job row to the `chain` row; `blockers_remaining` stays on `job`. Its write-based bookkeeping section is this design applied to the split schema.
- **Unbounded blockers** (`design/unbounded-blockers.md`): its `job_blocker.blocked` flip has to follow the same write-based rule.
