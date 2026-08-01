# Concurrent deduplication

Make deduplication hold when two transactions create the same key at the same time. Today it holds
only on the serialized adapters; on PostgreSQL it is a check-then-insert race.

## Problem

`createChains` decides deduplication with a plain `SELECT` and then inserts what the `SELECT` did not
match, in one statement (`state-adapter.pg.ts`):

- `existing_deduplicated` joins `job` on `deduplication_key` / `chain_type_name` with the `scope`,
  `windowMs` and `excludeChainIds` predicates.
- `to_insert_all` is every input entry that CTE did not match.
- `inserted_jobs` inserts them.

All CTEs of one statement share one snapshot. Under READ COMMITTED — PostgreSQL's default, and what
`withTransactionHooks` runs at unless the caller changes it — two concurrent `createChain` calls with
the same key both take their snapshot before either commits, both match nothing, and **both insert**.
The result is two live chains with the same `deduplication_key`, each reported `deduplicated: false`.

Nothing at the storage layer prevents it. `{{table_prefix}}job_deduplication_idx` and
`{{table_prefix}}chain_deduplication_idx` are plain indexes, not unique, and the create path takes no
lock. The only `pg_advisory_xact_lock` in the adapter guards migration bootstrap.

Intra-batch duplicates _are_ handled — `to_insert` keeps the lowest `ord` per
`(dedup_key, chain_type_name)` — so the guarantee holds within one `createChains` call and breaks
across calls.

### Why only PostgreSQL

In-process (`state-adapter.in-process.ts`) and SQLite (`state-provider.better-sqlite3.ts`,
`state-provider.node-sqlite.ts`) both declare `transactionConcurrency: "serialized"` and take a global
write lock per transaction, so check-then-insert is atomic for free. Both PostgreSQL providers
(`pg-pool`, `postgres-js`) declare `"concurrent"`. PostgreSQL is the only adapter exposed.

This is also why nothing caught it: `conformance/state-adapter-cases/create-chains.ts` has no
concurrent case at all, and `docs/.../guides/deduplication.md` documents "returns the existing chain"
with no concurrency caveat — an unqualified guarantee the PostgreSQL adapter does not provide.

## Why a unique index is not the fix

Deduplication is conditional. `scope: "running"` matches only chains with no completed terminal job,
`windowMs` bounds by age, `excludeChainIds` removes specific chains. Two chains with the same key are
_legitimately_ allowed to coexist once the first completes or the window lapses. No unique or partial
unique index expresses that, so the constraint would reject writes the documented semantics permit.

So the fix is mutual exclusion around the existing conditional check — unless the conditional part
moves off the index and into the conflict _action_, which is option 3.

## The snapshot constraint

**The lock cannot live in the same statement as the deduplication `SELECT`.** This rules out the
otherwise-obvious "prepend a lock CTE to `createChains`, pay no extra roundtrip" shape, and it applies
to every option below.

Under READ COMMITTED the snapshot is taken at statement start. If the lock and the check are one
statement, the second transaction takes its snapshot, _then_ blocks, then unblocks after the first
commits — and evaluates `existing_deduplicated` against the pre-lock snapshot, where the first
transaction's root job does not exist. It dedups against nothing and inserts a duplicate. The lock is
acquired correctly and buys nothing. (`ON CONFLICT DO UPDATE` does re-read the latest row version via
EvalPlanQual, but only for the row it locks — not for other tables read by the same statement.)

So acquisition must be its own statement, so that the create statement takes a fresh snapshot after
the lock is held. That is one extra roundtrip, paid only when the batch carries deduplication keys.

### It only fixes READ COMMITTED

At REPEATABLE READ the snapshot is fixed at _transaction_ start, so no statement boundary helps: the
second transaction cannot see the first's committed job however it is ordered. A statement-boundary
lock cannot make deduplication correct there. Options are to document READ COMMITTED as the supported
level, or to make the contention detectable so the caller retries — see the `40001` note under
option 2.

## Options

### 1. `pg_advisory_xact_lock`

`SELECT pg_advisory_xact_lock(...)` for the keys a batch carries, as a separate statement before the
create, released automatically at commit.

**Zero write amplification — the reason to want this.** The lock lives in shared memory: no heap
tuple, no WAL record, no dead tuple, no vacuum debt, no rows to retain or sweep. Acquisition is a
hash, a partition LWLock, and a shared-table insert — on the order of a microsecond of CPU,
irrelevant next to the roundtrip it now costs. Every other option pays a persistent write on a path
that has none today.

**The cost is blast radius, not capacity.** Advisory locks draw from a pool sized
`max_locks_per_transaction × (max_connections + max_prepared_transactions)` — defaults give 6400
slots. Note this is a _global_ pool, not a per-transaction cap: a single transaction may hold far
more than 64. So a 100-key batch is unremarkable, and exhaustion needs roughly 64 concurrent batches
of that size.

What makes it serious is _who_ fails. The pool is shared with the entire database, so overflow
raises `out of shared memory / You might need to increase max_locks_per_transaction` in **unrelated
sessions** — a library taking an unbounded number of locks per user transaction can break queries
that have nothing to do with Queuert. Per-key locking is therefore unacceptable as shipped: the
number of locks is caller-controlled and unbounded.

#### 1a. Bucketed (the viable form)

Hash keys into a fixed bucket space and lock the distinct buckets:

```sql
SELECT pg_advisory_xact_lock($tag, bucket)
FROM (SELECT DISTINCT hashtext(chain_type_name || key) % $buckets AS bucket FROM unnest(...)) b
ORDER BY bucket
```

Lock count is bounded by a constant the library chooses, independent of batch size. The blast-radius
problem disappears and write amplification stays at zero.

The cost moves to **false serialization**: two unrelated keys sharing a bucket exclude each other.
The lock must be held to commit — releasing after the create statement collapses the mechanism
entirely (T1 locks, inserts uncommitted, releases; T2 locks, sees nothing, duplicates) — so false
sharing lasts for the caller's whole `withTransactionHooks` block. A caller doing slow work in that
block after `createChain` throttles `1/$buckets` of all unrelated deduplicated creates. Option 2 has
the same hold duration but only for _true_ conflicts.

Bucket count is a straight trade: fewer buckets, more false sharing; more buckets, more of the
original pool pressure back. Something like 64 keeps worst-case usage in the same order as a single
table lock while making collisions rare.

**Gives REPEATABLE READ nothing.** No conflicting tuple means no `40001`; the second transaction
inserts cleanly and silently duplicates. Under this option, "document READ COMMITTED as required" is
the only available answer.

A cruder variant locking `chain_type_name` alone bounds usage to one entry per type, but serializes
all deduplicated creates of a type rather than only colliding ones — strictly worse than bucketing
for the common case of many distinct keys with no real contention.

### 2. Row-lock table (preferred)

A dedicated table whose rows are the mutex, taking the _table_ idea from the migration lock but not
its lease mechanics:

```sql
CREATE TABLE {{schema}}.{{table_prefix}}dedup_lock (
  chain_type_name   TEXT NOT NULL,
  deduplication_key TEXT NOT NULL,
  touched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_type_name, deduplication_key)
)
```

Acquired as its own statement before the create:

```sql
INSERT INTO {{schema}}.{{table_prefix}}dedup_lock AS l (chain_type_name, deduplication_key)
SELECT ... FROM unnest(...) ORDER BY 1, 2
ON CONFLICT (chain_type_name, deduplication_key) DO UPDATE SET touched_at = l.touched_at
```

- **`DO UPDATE`, not `DO NOTHING`.** `DO NOTHING` skips without locking and provides no exclusion at
  all. The no-op update is the whole mechanism: it takes an exclusive row lock, held to commit.
- **Both contention cases are covered.** For an existing row the second transaction waits on the row
  lock. For a brand-new key — the case that actually matters — PostgreSQL's speculative insertion
  makes the second waiter block on the first's token until it commits, then re-check.
- **No shared-memory pressure.** Row locks live in the tuple header, not the `max_locks_per_transaction`
  pool. A 100-key batch takes 100 row locks and one `ROW EXCLUSIVE` table lock. This is the decisive
  advantage over option 1: no configuration floor, no batching cliff.
- **Setting a non-indexed column (`touched_at = l.touched_at`) keeps the update HOT-eligible** — no
  index churn, and the dead tuple is prunable on the page.
- **Gives REPEATABLE READ a signal.** At RR, a caller conflicting on a persistent lock row gets
  `could not serialize access due to concurrent update` (`40001`) — a retryable error, which is the
  correct outcome for the case the fix cannot otherwise handle. This depends on the row persisting;
  see below.

**Costs.** Heap writes on a path that previously had none, and one row per distinct
`(chain_type_name, deduplication_key)` ever used. The write cost is largely absorbed by existing
tuning — the `vacuum_tuning` migration already pins `fillfactor` and `autovacuum_vacuum_cost_delay = 0`,
and the later migration set a fixed `autovacuum_vacuum_threshold = 5000 / scale_factor = 0`; the new
table joins that policy. Growth needs a sweep of rows untouched for N days, which folds into
[builtin-cleanup.md](builtin-cleanup.md).

**Why not delete the lock row at the end of the creating transaction.** Considered, and rejected on
three counts:

- It _increases_ vacuum work. A persistent row costs one HOT no-op update per contended create, with
  zero index churn. Delete-and-reinsert writes a fresh tuple _and_ a fresh index entry per create and
  kills both, giving vacuum index cleanup it otherwise would not have.
- It does not shorten the hold. A waiter blocks on the holder's xid, not on the row's liveness, so
  deleting mid-transaction does not release it early — it is freed at commit either way.
- It removes the RR safety net above. With no live conflicting tuple there is no `40001`; the second
  transaction inserts cleanly and silently produces the duplicate.

### 3. Deduplication slot table with conditional takeover

The same table shape as option 2, but the row _owns the key_ instead of merely guarding it — so the
`ON CONFLICT` that was a no-op mutex becomes the deduplication decision itself:

```sql
CREATE TABLE {{schema}}.{{table_prefix}}chain_dedup (
  chain_type_name   TEXT NOT NULL,
  deduplication_key TEXT NOT NULL,
  chain_id          {{id_type}} NOT NULL,  -- the chain this key currently resolves to
  completed_at      TIMESTAMPTZ,           -- denormalized from that chain
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_type_name, deduplication_key)
)
```

The key is total and unconditional; the _scope_ moves into the `DO UPDATE` action, which is built per
statement and therefore per call:

```sql
INSERT INTO {{schema}}.{{table_prefix}}chain_dedup AS d
  (chain_type_name, deduplication_key, chain_id, completed_at, created_at)
SELECT ... FROM unnest(...) ORDER BY 1, 2
ON CONFLICT (chain_type_name, deduplication_key) DO UPDATE
SET chain_id     = CASE WHEN <takeover> THEN excluded.chain_id   ELSE d.chain_id     END,
    completed_at = CASE WHEN <takeover> THEN NULL                ELSE d.completed_at END,
    created_at   = CASE WHEN <takeover> THEN excluded.created_at ELSE d.created_at   END
RETURNING chain_id, (chain_id = excluded.chain_id) AS created
```

`<takeover>` is composed from that call's options — `false` for `scope: "any"`,
`d.completed_at IS NOT NULL` for `scope: "running"`, `OR d.created_at < now() - $window` for
`windowMs`, `OR d.chain_id = ANY($ids)` for `excludeChainIds`.

- **This is the only option that keeps `scope` per call.** A partial unique index on the chain (or
  root job) row cannot: an index predicate is static, so the scope would have to become a property of
  the chain type. Here the predicate is an expression in the statement, so two callers can use
  different scopes against the same key.
- **The predicate is evaluated fresh, not against the snapshot.** `ON CONFLICT DO UPDATE` re-reads the
  latest version of the conflicting row via EvalPlanQual, which is exactly the guarantee the snapshot
  section says a `SELECT` cannot have. The conditional check is therefore atomic without a separate
  lock statement.
- **Mixed scopes stay coherent.** The slot always points at the newest chain for the key, so `any`
  (never takes over) returns whatever the key currently resolves to — today's
  `ORDER BY created_at DESC` semantics — while `running` takes over once the slot's chain is complete.
- **Makes `windowMs` / `excludeChainIds` cheap.** Both collapse to an `OR` in the `CASE`, replacing the
  jsonb-unnest join in `existing_deduplicated`. Their fate in
  [deduplication-options-rework.md](deduplication-options-rework.md) stops being a correctness input.
- **Same RR signal and same HOT-update property as option 2** — the primary-key columns never change,
  so takeover and no-op alike are HOT, and a conflict at REPEATABLE READ raises a retryable `40001`.

**Costs.**

- **A deduplication hit still needs a second statement**, for the opposite reason to option 2. The slot
  returns the resolved `chain_id` from a fresh row version, but the _chain's own rows_ were committed
  by another transaction after this statement's snapshot, so they cannot be read in the same statement.
  Creating is one statement; deduplicating is two. Option 2 is unconditionally two.
- **Requires chain-level completion to be denormalized** onto the slot (`completed_at`), which
  `finishJob` must maintain — the same denormalization the partial-index variant would need on the
  chain or root job row. Divergence between slot and chain is a new failure mode with no equivalent
  today.
- **Retention is worse than option 2's**, not better: the row is load-bearing state, not a discardable
  mutex, so it cannot be swept purely by age without changing deduplication behavior for keys that
  are still referenced.
- **Same deadlock ordering requirement** as options 1 and 2.

This is a larger change than option 2 — it replaces the deduplication mechanism rather than adding
mutual exclusion around the existing one, and `existing_deduplicated` / the `getChain`-by-deduplication
reads would have to be re-derived against the slot.

### 4. Document as best-effort

Qualify the docs and tell users to run SERIALIZABLE with retry if they need strictness. Cheapest, and
honest, but leaves an unqualified guarantee in the guide unmet by the default configuration.

## Approach

The real choice is between **1a** and **2**; option 3 replaces the mechanism rather than fixing it,
and option 4 concedes the guarantee. Both live contenders acquire in a separate statement issued only
when the batch carries deduplication keys, and both need ordered acquisition.

|                     | 1a bucketed advisory         | 2 row-lock table                      |
| ------------------- | ---------------------------- | ------------------------------------- |
| write amplification | none                         | one HOT tuple per deduplicated create |
| retention           | none                         | row per key, needs sweep              |
| lock-table pressure | bounded constant             | none (tuple header)                   |
| false serialization | `1/$buckets`, held to commit | none                                  |
| REPEATABLE READ     | silently wrong               | retryable `40001`                     |

Two arguments decide it, and they point in opposite directions:

- **For 1a** — it is the only option that adds no persistent write to a path that has none today.
  Option 2's amplification is real: a tuple version per deduplicated create, plus a row per key
  forever.
- **For 2** — its cost is _proportional and local_. It scales with creates that actually use
  deduplication, it is a HOT update on a page the workload keeps touching (so opportunistic pruning
  handles it without index scans), the fillfactor and autovacuum policy it needs is already in place,
  and next to the job insert it accompanies — jsonb input plus several index entries — the lock write
  is a small fraction. Option 1a's cost is instead a fixed global resource and a throughput coupling
  to caller transaction duration.
- **Tiebreaker** — the REPEATABLE READ row is a correctness difference, not a performance one. Only
  option 2 makes contention _detectable_ at RR; under 1a, deduplication is silently wrong there and
  documenting READ COMMITTED as mandatory is the only recourse.

Leaning 2 on the tiebreaker, but this should be settled by measurement (see open questions) rather
than on paper — if the write cost proves material under load, 1a plus a documented isolation-level
requirement is a defensible trade.

Ordering matters either way: a batch touching keys `{A,B}` against a concurrent `{B,A}` deadlocks, detected only
after `deadlock_timeout` (default 1s) and resolved by killing one transaction. Sorting the input
arrays makes acquisition order deterministic. Note this is not contractual — row lock order follows
the scan, and PostgreSQL does not guarantee evaluation order of a set-returning function — so it needs
a test, not just an `ORDER BY`.

Land the conformance case first, gated on `transactionConcurrency !== "serialized"`: two separate
transactions each calling `createChain` with the same key, overlapping, expecting exactly one chain and
one `deduplicated: true`. It should fail against PostgreSQL today.

## Open questions

- **Speculative-insertion timing.** That a waiter blocking on a speculative insertion of a brand-new
  key is released exactly at commit is the load-bearing assumption of option 2, and the precise case
  the fix exists for. It needs verification by test against real PostgreSQL, not reasoning.
- **Sort determinism.** Does sorted input reliably produce sorted row-lock acquisition under a
  concurrent batch workload, or is an explicit per-key statement needed to guarantee ordering?
- **REPEATABLE READ.** Document READ COMMITTED as required, detect and reject a higher isolation level,
  or rely on the `40001` from the lock row and document the retry?
- **Scope.** `createContinuationJob` carries its own `ON CONFLICT`-based continuation race handling and
  no deduplication key — confirm it is genuinely out of scope.
- **Cost under contention — this is what decides 1a vs. 2.** Measure in
  `benchmarks/query-performance` (same-key contention, and a 100-distinct-key batch) before
  committing: option 2's write amplification and vacuum behavior under a hot key, against option 1a's
  false serialization at a candidate bucket count. The extra roundtrip is common to both.
- **Bucket count, if 1a.** What value keeps worst-case lock usage in the same order as a single table
  lock while making collisions rare, and how badly does false sharing degrade when a caller holds the
  transaction open after `createChain`?

## Surface

- **Core** — no API change; conformance gains concurrent-deduplication cases on `createChains`.
- **PostgreSQL** — an acquisition statement in the `createChains` path; under option 2 also a new
  `dedup_lock` table and migration (joining the existing vacuum tuning), under option 1a no schema
  change at all.
- **SQLite / in-process** — no change; serialized transactions already provide the guarantee.
- **Docs** — `guides/deduplication.md` states the concurrency guarantee and its isolation-level
  requirement; `advanced/postgres-internals.md` documents the new table.

## Dependencies

- Under options 2 and 3, row growth wants the sweep from [builtin-cleanup.md](builtin-cleanup.md);
  option 1a has nothing to retain.
- Independent of [deduplication-options-rework.md](deduplication-options-rework.md), but that doc's
  fate for `windowMs` / `excludeChainIds` changes how conditional the matching predicate stays — and
  the conditionality is exactly why a unique index cannot replace the lock.
- Related failure mode, different cause: [caller-supplied-id-collisions.md](caller-supplied-id-collisions.md).
