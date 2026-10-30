# Chain table

Move chain state off the head job's row into its own `chain` table, give a chain an id of its own instead of reusing its head job's id, and make every cross-transaction invariant a write-write conflict, so the state adapter behaves correctly under READ COMMITTED, REPEATABLE READ and SERIALIZABLE.

## Problem

### A chain lock is a job lock

Chain state (`chain_status`, `chain_completed_at`, `chain_deduplication_key`, `chain_trace_context`) lives on the head job's row, and `chain.id === head.id`. Locking a chain locks its head job and locking the head job locks the chain, so every chain-level lock behaves differently depending on whether the chain is still on its head job:

- **Lost wake-up.** `lockBlockerChains` locks each blocker chain's head row until the creating transaction commits. Acquisition takes `FOR UPDATE OF j SKIP LOCKED`, so when the pending job _is_ that head, a worker woken at that moment skips it and idles until the next poll.
- **Stale current job.** `completeChain` locks the head, then the tail. `continueJobs` advances a chain without the head lock, so a continuation that commits while `completeChain` waits on the tail row hands the handler the already-completed old tail and leaves the new tail unlocked for a worker to acquire.
- **Head-row churn.** Every status change of a head job (acquire, reschedule, reclaim, complete) is a non-HOT update of a row that also carries the chain columns, so it rewrites the chain partial indexes (`chain_idx`, `chain_running_idx`, …) on `job` even though no chain state changed.

### Lock-then-recheck only works under READ COMMITTED

Blocker bookkeeping today is lock-then-recheck: attaching a blocker _locks_ the blocker head and reads its status; `unblockJobs` locks the blocked dependents and recomputes `NOT EXISTS (incomplete blocker)`. Both rely on READ COMMITTED taking a fresh snapshot per statement after a lock wait. Under REPEATABLE READ the recheck reads the transaction's original snapshot, and a lock that was only _held_ (not used to write) by the other transaction raises no serialization failure. Two races then leave a dependent `blocked` forever, with every transaction committing successfully:

| Race                                                                       | What REPEATABLE READ does today                                                                                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A dependent is attached to blocker K after K's completer took its snapshot | The completer's `job_blocker` read misses the new row; the attach saw K `running`, so nobody unblocks the dependent               |
| A dependent waits on K1 and K2, both complete concurrently                 | Each completer sees the other blocker `running` in its snapshot; the dependent's row was only locked, so neither one gets a 40001 |

SERIALIZABLE catches both (SSI aborts one side of the write skew); READ COMMITTED is correct by fresh snapshots. Only REPEATABLE READ is silently wrong. `design/unbounded-blockers.md`'s `job_blocker.blocked` flip has the same shape and the same hole.

Head-row aliasing also costs under REPEATABLE READ and SERIALIZABLE: an acquisition, reschedule or reclaim rewrites the head row, so a user transaction that attaches that chain as a blocker after taking its snapshot fails with a serialization error for an event unrelated to the chain.

## Design

### Two entities, two ids

A chain is a row in `chain`; its jobs are rows in `job` that point at it. A chain's id is its own: it is no longer its head job's id.

- `job.chain_id` references `chain.id`; the head job is the job with `chain_index = 0`.
- Core generates both ids with the adapter's `generateId` and runs `validateId` on both.
- A chain lock is the chain row, a job lock is the job row, and the two never alias.

Making the ids independent (not just storing them twice) removes the remaining special cases of "the head is the chain": the `chainMembers` `OR` predicate (`(id = X AND chain_index = 0) OR (chain_id = X AND chain_index > 0)`), the `WHERE chain_index > 0` partial unique index that excludes heads, and every `job.id === job.chainId` branch in the in-process adapter. It also lets jobs be removed without removing the chain: the "cleanup chains with 1k+ jobs" epic and "reset jobs in chains" both need a chain whose identity outlives its head job.

### Schema (PostgreSQL)

```sql
CREATE TABLE {{schema}}.{{table_prefix}}chain (
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  id                {{id_type}} PRIMARY KEY,
  has_dependents    boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed')),
  type_name         text NOT NULL,
  deduplication_key text,
  trace_context     text
) WITH (fillfactor = 90, /* job's autovacuum settings */);

chain_deduplication_idx  ON chain (deduplication_key, created_at DESC) WHERE deduplication_key IS NOT NULL
chain_idx                ON chain (type_name, created_at)
chain_running_idx        ON chain (type_name, created_at)   WHERE status = 'running'
chain_completed_idx      ON chain (type_name, completed_at) WHERE status = 'completed'
```

On `job`:

- Drop `chain_status`, `chain_completed_at`, `chain_deduplication_key`, `chain_trace_context` and the four head-only indexes above.
- Add `blockers_remaining integer NOT NULL DEFAULT 0`.
- Replace `chain_index_idx ON job (chain_id, chain_index) WHERE chain_index > 0` with a full `UNIQUE (chain_id, chain_index)`: it now covers the head too, so one index serves head lookup, tail lookup and `listChainJobs`.
- No foreign key from `job.chain_id` to `chain.id`: the check would take `FOR KEY SHARE` on the chain row for every job insert, continuations included. `deleteChains` already deletes both sides.

`fillfactor = 90`: the `running → completed` flip changes indexed columns and can never be HOT, but the `has_dependents` write (once per attach, see below) touches no indexed column and can be HOT if the page has room.

### Operations

| Operation              | Rows written                                                                                    | Locks                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `createJobs`           | 1 chain insert + 1 job insert per chain                                                         | —                                                                                                                 |
| `startJobAttempts`     | 1 job update                                                                                    | job row only (`FOR UPDATE OF j SKIP LOCKED`), chain read by primary key                                           |
| `continueJobs`         | 1 job update + 1 job insert; **the chain row is not touched**                                   | the continued job                                                                                                 |
| `completeJobs`         | 1 job update + 1 chain update (`status`, `completed_at`), `RETURNING has_dependents`            | the job, the chain row                                                                                            |
| `addJobsBlockers`      | `UPDATE chain SET has_dependents = true` per blocker, `job_blocker` inserts, 1 dependent update | blocker chain rows (by the update)                                                                                |
| `unblockJobs`          | skipped unless `has_dependents`; then one `UPDATE job SET blockers_remaining = … - n`           | dependent job rows (by the update)                                                                                |
| `getChains({ lock })`  | —                                                                                               | chain rows only; the head and tail are read in a following statement so READ COMMITTED sees their latest versions |
| `completeChain` (core) | —                                                                                               | chain row, then current job, then follow `continued_to_id` (below)                                                |

**Lock order.** A statement or transaction that locks both takes chain rows first (ordered by id), then job rows (ordered by id). In a single statement this needs a `MATERIALIZED` CTE for the chain locks that the job scan depends on; otherwise the planner may interleave them. `startJobAttempts`, `reclaimExpiredJobAttempts` and `stopWorker` use `SKIP LOCKED` and never wait, so they are exempt; the reclaim statements lock worker rows and job rows but never chain rows, and read chain columns by primary key.

### Finding the current job in `completeChain`

`completeChain` locks the chain row, finds the tail through `(chain_id, chain_index)`, locks it, and while the locked job's `continued_to_id` is set, locks that job instead, each lock in a new statement:

```
B: lock chain C                                   -- no wait: continuing never writes the chain row
B: tail by (chain_id, chain_index) → J1           -- J2 not committed yet
B: lock J1                                        -- waits on worker A's continuation of J1
A: COMMIT                                         -- J1 completed, continued_to_id = J2; J2 inserted
B: J1.continued_to_id = J2 → lock J2              -- new statement, sees J2
B: J2.continued_to_id IS NULL → current job
```

It is correct because a job can only be continued by writing its own row, so once `completeChain` holds a job whose `continued_to_id` is null, nothing can move the chain past it; and a move that happened while it waited is recorded on the row it waited for. In practice the loop runs zero times, or once when it raced a continuation. Under REPEATABLE READ the lock on the changed row raises 40001 instead, and the retry starts from a snapshot that already has J2.

### Write-based blocker bookkeeping

Rule: **every invariant that pairs a read in one transaction with a write in another must be a write-write conflict on a shared row.** READ COMMITTED then waits and re-reads the latest version (EvalPlanQual); REPEATABLE READ and SERIALIZABLE raise 40001 and the caller retries. Neither reads a stale value silently.

- **Attach vs completion of the blocker** share the blocker's chain row. Attaching _writes_ it (`has_dependents = true`, on every attach, not only the first), and the dependent's `blockers_remaining` is set to the number of its `job_blocker` rows whose blocker chain the update returned `running`. Completion writes the same row and gets `has_dependents` back from its own `UPDATE … RETURNING`, which is the latest version after any wait. This also restores skipping `unblockJobs` for chains without dependents, without a separate `EXISTS`.
- **Two blockers of one dependent completing concurrently** share the dependent's job row: `unblockJobs` decrements `blockers_remaining` by the number of that dependent's `job_blocker` rows for the completed chain, and flips the job to `pending` when it reaches zero. It is one statement instead of today's two (`lockBlockedJobs` + `unblockJobs`), and the `NOT EXISTS` join over every blocker's chain row goes away.

### Behavior by isolation level

Results from the spike's two-connection interleavings (PostgreSQL 18):

| Race                                                                   | Today (RC)                 | Today (RR)              | Today (SER)    | This design (RC / RR / SER)             |
| ---------------------------------------------------------------------- | -------------------------- | ----------------------- | -------------- | --------------------------------------- |
| Worker acquires a pending head while it is being attached as a blocker | skipped (lost wake-up)     | skipped                 | skipped        | acquired / acquired / acquired          |
| `completeChain` races a continuation (chain past its head)             | stale J1, J2 left unlocked | 40001 → retry           | 40001 → retry  | J2 / 40001 → retry / 40001 → retry      |
| Attach races the blocker's completion                                  | correct                    | dependent stuck blocked | 40001 → retry  | correct / 40001 → retry / 40001 → retry |
| Two blockers complete concurrently                                     | correct                    | dependent stuck blocked | 40001 → retry  | correct / 40001 → retry / 40001 → retry |
| RR/SER attach after the blocker's head was acquired                    | —                          | spurious 40001          | spurious 40001 | — / ok / ok                             |
| RR/SER attach after the blocker continued                              | —                          | ok                      | ok             | — / ok / ok                             |

**Residual cost: attach vs attach.** Two transactions attaching dependents to the same blocker both write its chain row. Under READ COMMITTED they serialize until the first commits, as today's exclusive head lock already does. Under REPEATABLE READ the second gets 40001 when the first committed after its snapshot; in a contention benchmark (4 attachers, 32 blockers, 2 ms between snapshot and attach) that was 7% of attach transactions under RR and 11–15% under SERIALIZABLE. If that matters for fan-out-heavy workloads, READ COMMITTED and SERIALIZABLE can attach with `FOR SHARE` once `has_dependents` is already true (RC re-reads after the wait; SSI detects the rw-conflict); REPEATABLE READ cannot, because only a write produces its conflict.

**Worker statements.** Acquisition, lease renewal, reclaim, `stopWorker` and the fallback reschedule are autocommit statements, so they run at the session's `default_transaction_isolation`. Under REPEATABLE READ or SERIALIZABLE a single statement that meets a row changed after its snapshot raises 40001 instead of re-reading it, and `SKIP LOCKED` scans under SSI create rw-conflicts between workers; today a throwing claim stops the worker gracefully. Supporting those levels therefore needs the worker's statements pinned to READ COMMITTED (a dedicated connection setting, or treating 40001 there as an empty result), independently of the chain table. Only the transactions a user passes in (client methods, `complete`) run at the user's level.

## API

- `Chain.id` is the chain's own id. The head job's id is exposed separately (`Chain.headJobId`, or head/tail jobs on `Chain` as in the "expand the Chain type" idea). `Job.chainId` keeps its meaning.
- `createChain({ id })` assigns the **chain** id; the head job's id is always generated.
- Code that uses a chain id as a job id — `getJob({ id: chain.id })`, `getJobs({ ids: [chain.id] })`, `getJobBlockers({ jobId: chain.id })`, `rescheduleJob({ id: chain.id })` — has to switch to the head job id. The examples (`showcase-long-running-jobs`, `showcase-queries`, `showcase-chain-deletion`) and the core test suites do this today.
- `examples/showcase-blockers` re-publishes a notification by hand to work around the lost wake-up; drop that once attaching no longer locks the blocker's head job.
- State adapter contract: `createJobs` takes a `chainId` per head job; `completeJobs` returns `hasDependents`; `getChains({ lock })` no longer locks the head job (the conformance case "holds the chain lock implicitly for a single-job chain" asserts the old aliasing and changes); `unblockJobs` is counter-based.

## Migration

### Schema (`003`, after `002_worker_liveness`)

1. **Transactional:** create `chain` and its indexes; add `job.blockers_remaining`.
2. **Batched:** backfill `chain` from head rows: `id = head.id` (pre-upgrade chains keep the old equality), `has_dependents = EXISTS (job_blocker WHERE blocked_by_chain_id = head.id)`, status, timestamps, key, trace context. Repeat until no head row lacks a chain row.
3. **Batched:** set `blockers_remaining` on `blocked` jobs to the number of their `job_blocker` rows whose blocker chain is `running`.
4. **Non-transactional:** `CREATE UNIQUE INDEX CONCURRENTLY` on `job (chain_id, chain_index)`, then drop the partial `chain_index_idx`.
5. **Transactional:** drop the four head-only indexes and the four `chain_*` columns on `job`.

Steps 2–3 are batched so that a large `job` table never sits under one long transaction.

### Consumers: chain ids drain out

Chains created before the upgrade keep `chain.id === head.id`, so code that conflates the two keeps working for them and breaks only for chains created after it. A two-step rollout gives consumers a window to migrate:

1. **Decouple storage, keep generating equal ids.** Ship the schema, the new behavior and `Chain.headJobId`; core still creates a chain with `chainId = headJobId`. Nothing observable changes except the new field; conflating the two is documented as deprecated.
2. **Generate independent ids** (breaking). New chains get a fresh id; pre-upgrade chains keep the equality until they complete and are cleaned up.

### Rolling deploys

Step 5 removes columns that the previous release reads (`h.chain_status` in its unblock check, dedup, `listChains`). A rolling deploy with old and new workers side by side therefore needs either a stop-the-world upgrade, or an expand/contract split: release N runs steps 1–4 and also writes the head-row `chain_*` columns; release N+1 runs step 5. `002_worker_liveness` already requires stopping every previous-version process before it runs, so shipping both in one major keeps a single stop-the-world upgrade.

## Performance

From a spike on a 4-CPU Docker host (PostgreSQL 18). Treat differences under about 10% as noise.

**Raw-SQL harness** (each variant's hot-path statements written in the adapter's CTE shape; worker slots acquire in one transaction and complete in a second; mean of 2–3 rotated runs; WAL bytes per op):

| Scenario                                    | Today (head row) | Head row + write-based bookkeeping | **This design** | Chain table + `tail_job_id` |
| ------------------------------------------- | ---------------- | ---------------------------------- | --------------- | --------------------------- |
| create, batched 100 (chains/s)              | 34,086 (688 B)   | 32,033 (702 B)                     | 27,449 (882 B)  | 27,874 (906 B)              |
| create, single ×8 (chains/s)                | 4,526 (739 B)    | 4,381 (747 B)                      | 4,104 (938 B)   | 3,828 (961 B)               |
| drain 1-step ×16 (jobs/s)                   | 1,652 (1,662 B)  | 1,912 (1,684 B)                    | 2,011 (1,537 B) | 2,025 (1,568 B)             |
| drain 4-step ×16 (jobs/s)                   | 1,344 (2,186 B)  | 1,864 (2,210 B)                    | 2,078 (1,678 B) | 1,882 (1,938 B)             |
| blockers fan-in ×8 (jobs/s)                 | 1,215 (2,032 B)  | 1,274 (2,044 B)                    | 1,659 (1,802 B) | 1,677 (1,829 B)             |
| size after 10k 3-step chains (after VACUUM) | 22.7 MB          | 23.3 MB                            | 22.3 MB         | 26.9 MB                     |

- Creation pays for the second insert: about 6–20% fewer chains/s and +27% WAL per chain.
- Processing gains come from two sources. Write-based bookkeeping (column 2) skips the unblock statements on completions without dependents. The table split (column 3 vs 2) adds 5–11% throughput and cuts WAL per job by 9–24%, because job status changes stop rewriting chain index entries.

**Real adapter.** A chain-table port of `@queuert/postgres` (chain split only: no write-based bookkeeping, and on a base whose acquisition still locked the head row) passed the full PostgreSQL suite.

- **processing-capacity:** within noise of stock: batched create −4%, single create −3%, processing −2% / +2%. The second insert is a small share of the end-to-end cost per chain.
- **query-performance:** point queries are within noise, with one exception. `startJobAttempt` went from 1.6 to about 2.7 ms because that base locked job and head together (`FOR UPDATE OF h, j`), one row for a single-job chain but two rows once the chain is its own table. `dev` already locks only the job, so this does not carry over.
- **`listChains` is 1.5–2× slower** (running/default 5 → 9 ms; running/independent 118 → 221 ms). The plan uses `chain_running_idx` as intended; the extra cost is the per-row head job lookup, since `Chain.input` comes from the head job. Worth profiling before shipping.

## Alternatives considered

- **Chain table with a `tail_job_id` pointer**, rewritten by every continuation, as the original TODO proposed. `completeChain` gets the current job in two statements and needs no loop. But every continuation writes the chain row: +15% WAL on 4-step chains, the chain heap grows 60%, continuations queue behind `completeChain` holders, and RR attaches to an advancing blocker chain abort 30% of the time (vs 7%). The `continued_to_id` follow gives the same correctness without writing the chain row on the hot path.
- **Keep the head row, add only write-based bookkeeping.** RR-safe and the cheapest migration, but it keeps the lost wake-up and the head-row churn, and RR/SER attaches abort spuriously whenever the blocker's head job is acquired, rescheduled or reclaimed.
- **Keep the head row, separate chain and job locks with lock strengths** (blockers take `FOR KEY SHARE`, completion takes `FOR UPDATE`, acquisition takes `FOR NO KEY UPDATE`). It fixes the lost wake-up under RC, but locks alone do not produce conflicts under REPEATABLE READ, and acquisition and reclaim still rewrite the row that holds chain state.

## SQLite and in-process

SQLite serializes writers, so none of the lock races apply. It adopts the same schema (`chain` table, independent ids, `blockers_remaining`, `has_dependents`) for parity and to skip the unblock statement. The in-process adapter keeps a chain map next to its job map and drops its `job.id === job.chainId` branches.

## Related designs

- **Chain identity** (`design/chain-identity.md`): the `running`-scope and `any`-scope partial unique indexes go on `chain` instead of on head job rows, next to the persisted `scope`.
- **Unbounded blockers** (`design/unbounded-blockers.md`): the `job_blocker.blocked` flip must follow the write-based rule to be safe under REPEATABLE READ. `blockers_remaining` is a hot row for massive fan-in (every completing blocker writes the collector row), which that design's system-chain approach has to absorb.
- **Built-in cleanup** and **truncating chains with 1k+ jobs**: the chain row carries status and identity, so completed jobs can be deleted without losing the chain.

## Open questions

- Two-step id rollout vs. independent ids from the first release.
- Stop-the-world vs. expand/contract for the column drop.
- `has_dependents` as a flag written on every attach vs. a counter (a counter would also report the number of dependents).
- Whether `listChains` keeps returning the head job's `input`, or reads it lazily.

## Tests

- Conformance (all adapters): the races in the isolation table, with two connections on PostgreSQL and run under READ COMMITTED, REPEATABLE READ and SERIALIZABLE; independent chain and head job ids; deleting a chain's jobs and its chain row together.
- Migration: backfill of `chain`, `has_dependents` and `blockers_remaining` from a seeded pre-`003` database, including blocked dependents with mixed completed and running blockers; pre-upgrade chains keep `chain.id === head.id`.
