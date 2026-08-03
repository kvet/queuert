# Job model v3 — the chain becomes a row

> **Status**: design. Breaking (`major`) across `@queuert/core` and all three state adapters.
> Supersedes the storage half of [chain-model.md](../docs/src/content/docs/advanced/chain-model.md).

v2 stores a chain as a **predicate over the job table** (`chain_index = 0` is the head,
`continued_to_id IS NULL` is the tail). v3 stores it as a **row**. Three tables — `chain`, `job`,
`job_blocker` — where v2 has two.

Nothing above the `StateAdapter` boundary changes shape: `chain.id` is still the head job's id, the
Promise analogy still holds, and no client method changes signature on v3's account. What changes is
that chain-level facts stop being inferred from job rows, and the 1B-row table stops carrying four
indexes and ~80 bytes per row that exist only to answer chain-level questions.

**Partitioning is out of scope.** v3 targets 1B rows on an ordinary, unpartitioned PostgreSQL or
SQLite database. [partitioned-pg-adapter.md](partitioned-pg-adapter.md) remains a deferred, separate
adapter, and nothing here is shaped to anticipate it — see §8 for the one note worth carrying over.

v3 is a **redistribution of the shipped schema**, not a feature. It is implementable on its own, and
§4.5 accounts for every pending design it touches.

---

## 1. Why v2 stops scaling

The unified model was the right call at 1M rows and is the wrong one at 1B. Four costs, all traceable
to "the chain has no row of its own".

What makes 1B rows survivable _without_ partitioning is that every hot index is **partial** on the
active subset (`completed_at IS NULL`), so acquisition and pending-work costs track the working set
rather than lifetime volume. The completed pile is touched only by listing and retention, both of
which can be covered range scans. v2 undermines this in one specific way: four of its indexes are
chain-shaped but live on the job table, so the highest-write table in the system maintains indexes for
an entity it does not store.

### 1.1 Chain-level facts are denormalized onto every job

`chain_type_name` and `chain_trace_context` are copied onto **every** job row because the worker and
the entity mapper need them and there is nowhere else to put them. A W3C `traceparent` is 55
characters; a type name is typically 15–30.

Be precise about what this buys, because the naive version of the argument is wrong. At ~80 B/row
and an average chain length of 3:

```
job table shrinks     ~80 B × 1B jobs      ≈ −80 GB
chain table appears   ~150 B × 330M chains ≈ +50 GB   (incl. tuple headers, its own PK)
                      ─────────────────────────────
net heap                                   ≈ −30 GB
```

Order-of-magnitude estimate, not a measurement. The net storage win is modest and is **not** the
argument. The argument is _where_ the bytes live: they move off the table that is scanned, locked,
updated and vacuumed continuously and onto one written two-to-three times per chain and then never
touched. A narrower `job` row means more candidate tuples per heap page during the acquisition scan
and per index page during listing.

It does **not** mean acquisition reads fewer bytes. Under the pairing invariant (§4.2) the worker
still receives the chain's type name and trace context on every acquisition — v3 moves that read from
the same heap page to a primary-key probe on another table. On the acquisition path in isolation this
is a small regression, and §7 books it as one.

### 1.2 Chain-level _mutable_ facts have no home at all

Immutable denormalization is merely wasteful. Mutable chain facts are worse — there is no row to put
them on, so each one needs its own workaround:

- **Chain completion** is derived: `completed_at IS NOT NULL AND continued_to_id IS NULL` on the
  _tail_. Every chain read pays a tail resolution, and
  [minimize-listing-surface.md](minimize-listing-surface.md) spends a paragraph arguing that seek is
  only `O(log N)` — an argument that only needs making because the fact is derived.
- [chain-identity.md](chain-identity.md) then needs chain completion **on the root** for its
  `running`-scope partial unique index, so it introduces `chain_completed_at` — a third copy of the
  same fact, written to a _different row of the same table_ inside the completion transaction.
- [minimize-listing-surface.md](minimize-listing-surface.md) calls `independent` (chains not
  referenced as a blocker) "the lone cross-table residual… no listing index on the chain row can
  ever cover it," and considers dropping it for that reason alone.

Three separate designs each work around the same missing row.

### 1.3 Chain indexes live on the job table

Four of the shipped indexes exist purely to let the job table impersonate a chain table
(the `migrations` array in
[state-adapter.pg.ts](../packages/postgres/src/state-adapter/state-adapter.pg.ts) —
`job_deduplication_idx` from the initial migration, the rest from `…_job_model_v2_indexes`):

| index                      | shipped definition                                                      | what it really is        |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------ |
| `chain_head_idx`           | `(created_at) WHERE chain_index = 0`                                    | the chain list           |
| `chain_tail_running_idx`   | `(chain_id) WHERE continued_to_id IS NULL AND completed_at IS NULL`     | the running-chain list   |
| `chain_tail_completed_idx` | `(chain_id) WHERE continued_to_id IS NULL AND completed_at IS NOT NULL` | the completed-chain list |
| `job_deduplication_idx`    | `(deduplication_key, created_at DESC) WHERE … chain_index = 0`          | the identity index       |

Their _entry_ counts are chain-scale, but they sit on the job table, so every job insert and every
job completion evaluates their predicates and they compete for buffer cache with the acquisition
index. `chain_tail_*` are the worst: a continuation deletes the old tail's entry from
`chain_tail_running_idx` and inserts the new tail's; a completion moves an entry from that index to
`chain_tail_completed_idx`. Index maintenance on the highest-write table in the system, to track a
fact about a different entity — and, because retention is `DELETE`-based, four more sets of dead index
entries for autovacuum to reclaim on the 1B-row table rather than the 330M-row one.

### 1.4 Identity uniqueness is enforceable only through a stack of workarounds

[chain-identity.md](chain-identity.md)'s core insight is exactly right: persist `scope` so the
matching predicate becomes **static**, and a partial unique index can enforce what
[#3](https://github.com/kvet/queuert/issues/3) proves a per-call `SELECT` cannot. But on a
single-table model it has to pay for that twice over — every index needs `chain_index = 0` to mean
"chain", and the `running` scope needs a `chain_completed_at` column denormalized onto the root
because the fact it wants lives on the tail:

```sql
UNIQUE (identity_key) WHERE identity_key IS NOT NULL AND chain_index = 0
                        AND identity_scope = 'any'
UNIQUE (identity_key) WHERE identity_key IS NOT NULL AND chain_index = 0
                        AND identity_scope = 'running' AND chain_completed_at IS NULL
```

Neither predicate term is about identity. Both are about the job table not being a chain table.

---

## 2. The v3 shape

```
chain ──1:N──▶ job ──1:N──▶ job_blocker ──N:1──▶ chain
```

### `chain` — the control plane

One row per chain. Inserted once, updated once per continuation, updated once at completion.

| column           | notes                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| `id`             | PK. **Equals the head job's id** — the public identity model is unchanged |
| `type_name`      | was `chain_type_name`, denormalized onto every job in v2                  |
| `created_at`     | listing sort key; equals the head job's `created_at`                      |
| `completed_at`   | **stored, not derived**. NULL ⇒ `running`                                 |
| `tail_job_id`    | advances on `continueWith`; equals `id` while the chain has one job       |
| `job_count`      | maintained in the same UPDATE as `tail_job_id`                            |
| `identity_key`   | was `deduplication_key`                                                   |
| `identity_scope` | `'any' \| 'running'`, non-null exactly when `identity_key` is             |
| `trace_context`  | was `chain_trace_context`, denormalized onto every job in v2              |

`tail_job_id` and `job_count` are deliberately **unindexed**, so the per-continuation UPDATE can be a
HOT update — no index entries rewritten, new version placed in the same heap page. Two caveats worth
stating rather than glossing:

- HOT requires free space **on the same page**. At ~150 B/row a page holds on the order of 50
  versions, so a chain longer than that breaks the HOT chain until autovacuum reclaims. The argument
  holds for typical 3-step chains and degrades exactly in the 1000-step case; `fillfactor` tuning
  moves the threshold but does not remove it.
- The **completion** update is never HOT, because `completed_at` is indexed (§5). Like any non-HOT
  update it inserts a new index tuple into _every_ index the new version qualifies for — the primary
  key and the created-at index included, not only the ones mentioning `completed_at`. v2's completion
  moves an entry between `chain_tail_running_idx` and `chain_tail_completed_idx` on the **job** table;
  v3's lands on the smaller, colder table. The churn moves, it does not disappear.

### Identity: [chain-identity.md](chain-identity.md), with the workarounds deleted

`identity_key` and `identity_scope` sit on `chain`, and the two partial unique indexes become what
they were always trying to be:

```sql
UNIQUE (identity_key) WHERE identity_key IS NOT NULL AND identity_scope = 'any'
UNIQUE (identity_key) WHERE identity_key IS NOT NULL AND identity_scope = 'running'
                        AND completed_at IS NULL
```

`chain_index = 0` is gone because every row _is_ a chain. `chain_completed_at` is gone because
`completed_at` is the chain's own column — the denormalization that
[chain-identity.md](chain-identity.md) introduces, that
[minimize-listing-surface.md](minimize-listing-surface.md) has to route around, and that the TODO
list carries as its own task, simply has no reason to exist once the chain has a row. **This is the
clearest illustration of what v3 is for**: it does not replace chain identity's design, it removes the
two predicate terms that were paying rent for the missing table.

**Why `scope` is stored**, restated because it is the load-bearing bit: if `scope` were only a query
parameter, the matching predicate would be built per call, and a per-call predicate cannot be an
index — which is exactly why two concurrent same-key creates both insert under READ COMMITTED
([#3](https://github.com/kvet/queuert/issues/3)). Persisting it makes the predicate static, so the
database enforces the invariant instead of a snapshot read guessing at it. On a _read_, `scope` then
selects which index to probe rather than filtering rows, which is why the same key can live under both
scopes without ambiguity. This retires [concurrent-deduplication.md](concurrent-deduplication.md) in
full — its whole option space of advisory locks and lock tables exists because the predicate was
conditional.

Two mechanical consequences that must not be lost:

- **`ON CONFLICT` infers one index.** A batch `createChains` carrying both scopes cannot target both
  partial indexes in one statement, so the create path either splits the batch by scope or catches
  `23505` and re-resolves. The second option is viable only **inside a savepoint** — an unhandled
  `23505` aborts the caller's transaction, the precise failure
  [caller-supplied-id-collisions.md](caller-supplied-id-collisions.md) exists to prevent — so it costs
  a `withSavepoint` round trip per create. [chain-identity.md](chain-identity.md) already flags the
  one-constraint limit for the caller-supplied-id case; this is the same limit on the same statement.
- **The losing path waits, and with `DO UPDATE` it holds a lock to commit.** Any conflicting insert
  waits on a concurrent _uncommitted_ inserter; `ON CONFLICT … DO UPDATE` additionally locks an
  already-committed winner for the rest of the _caller's_ transaction, and `txCtx` is caller-supplied.
  `DO NOTHING` plus a follow-up read avoids the second half, which is an argument for it. Either way
  batch claims must be folded on `(key, scope)` **and sorted**, or two overlapping batches in opposite
  key order deadlock. Booked in §7.

Whether the key is global or per-chain-type is [chain-identity.md](chain-identity.md)'s decision, not
v3's — the index leads with `(identity_key)` or `(type_name, identity_key)` accordingly, and nothing
else changes. Today's shipped matching is per-type.

### `job` — the data plane

One row per step. Append-heavy, mutated a bounded number of times, then cold forever.

Unchanged from v2 except: **drops** `chain_type_name`, `chain_trace_context`, `deduplication_key`;
**renames** `chain_index` → `position`; `chain_id` now references `chain(id)` rather than being a
self-FK into `job(id)`. Primary key stays `(id)`.

### `job_blocker` — the dependency edge

| column                | notes                                                                           |
| --------------------- | ------------------------------------------------------------------------------- |
| `job_id`              | the gated job                                                                   |
| `blocked_by_chain_id` | now a real FK to `chain(id)` rather than to a job row that happens to be a head |
| `index`               | declaration order                                                               |
| `created_at`          | **new** — when the block was established                                        |
| `trace_context`       | the edge's own                                                                  |

`created_at` is [minimize-listing-surface.md](minimize-listing-surface.md)'s fix for the
`listBlockedJobs` keyset, taken into core because it is a **correctness** fix rather than a
listing-minimization one: the alternative order key, `job_id`, can be caller-supplied, so ordering by
it turns a chronological list into "whatever the ids sort to". v3 reshapes this table anyway (new FK
target), so the column costs one migration instead of two.

Contrast `job_blocker.blocked` from [unbounded-blockers.md](unbounded-blockers.md), which v3 does
**not** take: that column carries runtime semantics — a seal lifecycle, a write-once-flip-once
contract — and belongs with the feature that defines them. `created_at` has no semantics beyond its
own ordering.

---

## 3. The rule that decides where a column lives

> A fact belongs on `chain` if it is true of the chain rather than of a step, **or** if it is read
> when no particular step is in hand. A fact belongs on `job` if a worker acquiring that step needs
> it.

Applied:

- `type_name` (chain's) — true of the chain, read by every chain listing → `chain`.
- `trace_context` (chain's) — true of the chain; the worker needs it, but the worker is handed the
  chain alongside the job (§4.2) → `chain`.
- `completed_at` (chain's) — true of the chain, and the thing every chain query filters on → `chain`.
- `identity_key` / `identity_scope` — true of the chain, and read with no step in hand → `chain`.
- `scheduled_at`, `attempt*` — properties of one step, read by acquisition → `job`.

The rule also settles the ones v3 does **not** ship. `blocker_ref_count` — which would make
`independent` a covered predicate, closing an open question in
[minimize-listing-surface.md](minimize-listing-surface.md) — and a per-chain `priority` both satisfy
it. v3 leaves the slot open rather than speculatively filling it; the point is that v2 had nowhere to
put them at all.

---

## 4. `StateAdapter` contract

### 4.1 Records

Three exported record types, mirroring the three tables:

```ts
export type StateChain = {
  id: string;
  typeName: string;

  createdAt: Date;
  identityKey: string | null;
  identityScope: "any" | "running" | null;

  completedAt: Date | null;

  tailJobId: string;
  jobCount: number;

  traceContext: string | null;
};

export type StateJob = {
  id: string;
  chainId: string;
  typeName: string;
  position: number;

  blocked: boolean;
  createdAt: Date;
  input: unknown;
  scheduledAt: Date;

  completedAt: Date | null;
  completedBy: string | null;
  continuedToId: string | null;
  output: unknown;

  attempt: number;
  lastAttemptError: string | null;
  lastAttemptAt: Date | null;

  attemptAt: Date | null;
  attemptBy: string | null;
  attemptUntil: Date | null;

  traceContext: string | null;
};

export type StateJobBlocker = {
  jobId: string;
  blockedByChainId: string;

  createdAt: Date;
  index: number;

  traceContext: string | null;
};
```

Two composites, named **subject-first** — the entity the caller asked for is element 0, the context
follows:

```ts
/** A chain with its head job and, when the chain has more than one job, its tail. */
export type StateChainWithJobs = [chain: StateChain, head: StateJob, tail: StateJob | undefined];

/** A job with the chain it belongs to. */
export type StateJobWithChain = [job: StateJob, chain: StateChain];
```

`StateChainWithJobs`' third element is **required and explicitly `undefined`** when
`chain.tailJobId === chain.id`, matching v2's `[StateJob, StateJob | undefined]` — every adapter emits
a fixed-arity array today, and a trailing-optional tuple would be a runtime shape change, not a
notation change.

### 4.2 The pairing invariant

> **A job is never returned without its chain.**

`StateJob` no longer carries `chainTypeName`, so `mapStateJobToJob` cannot construct the public `Job`
from a job row alone. Rather than reintroduce the denormalization for the mapper's convenience, every
job-returning method returns `StateJobWithChain`. The join is always a primary-key lookup, and on
write paths the chain row is often already in the transaction's working set.

| method                         | v2                                                                | v3                                                                                     |
| ------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `getChains`                    | `([StateJob, StateJob?] \| undefined)[]`                          | `(StateChainWithJobs \| undefined)[]`                                                  |
| `getChainsByIdentity`          | —                                                                 | `(StateChainWithJobs \| undefined)[]` (§4.4)                                           |
| `getJobs`                      | `(StateJob \| undefined)[]`                                       | `(StateJobWithChain \| undefined)[]`                                                   |
| `createChains`                 | `{ job, deduplicated }[]`                                         | `{ chain, job, created }[]`                                                            |
| `createContinuationJob`        | `{ job, deduplicated }`                                           | `{ chain, job, created }`                                                              |
| `startJobAttempt`              | `{ job? }`                                                        | `StateJobWithChain \| undefined`                                                       |
| `extendJobAttempt`             | `StateJob`                                                        | `StateJobWithChain`                                                                    |
| `finishJobAttempt`             | `StateJob`                                                        | `StateJobWithChain`                                                                    |
| `reclaimExpiredJobAttempt`     | `StateJob \| undefined`                                           | `StateJobWithChain \| undefined`                                                       |
| `rescheduleJobs`               | `StateJob[]`                                                      | `StateJobWithChain[]`                                                                  |
| `addJobsBlockers`              | `{ job, incompleteBlockerChainIds, blockerChainTraceContexts }[]` | `{ chain, job, blockers: { blocker: StateJobBlocker; blockerChain: StateChain }[] }[]` |
| `getJobBlockers`               | `[StateJob, StateJob?][]`                                         | `{ blocker: StateJobBlocker; blockerChain: StateChainWithJobs }[]`                     |
| `unblockJobs`                  | `{ unblockedJobs, blockerTraceContexts }`                         | `{ blocker: StateJobBlocker; gated: StateJobWithChain; released: boolean }[]`          |
| `deleteChains`                 | `{ deleted: [StateJob, StateJob?][], … }`                         | `{ deleted: StateChainWithJobs[], … }`                                                 |
| `listJobs` / `listBlockedJobs` | `Page<StateJob>`                                                  | `Page<StateJobWithChain>`                                                              |
| `listChains`                   | `Page<[StateJob, StateJob?]>`                                     | `Page<StateChainWithJobs>`                                                             |
| `listChainJobs`                | `Page<StateJob>`                                                  | `{ chain: StateChain \| undefined; jobs: Page<StateJob> }`                             |

Three deliberate departures from uniform pairing:

- **`getJobBlockers` and `unblockJobs` use records with disambiguating field names.** A wider
  positional tuple would hide exactly the ambiguity this section removes: `getJobBlockers` returns the
  **blocker** chain, `unblockJobs` returns the **gated** job's chain.
- **`listChainJobs` hoists the chain out of the page.** Single-chain by definition, so pairing every
  row would ship 20 copies of one `StateChain` per page. `chain` is `undefined` for a chain that does
  not exist — the client returns an empty page in that case today and must keep doing so.

Two subtleties the shapes must carry, both easy to lose in the rewrite:

- **`addJobsBlockers` returns the blocker chain per edge, not just the edge.** Core consumes two facts
  from today's parallel arrays that `StateJobBlocker` alone cannot supply: `incompleteBlockerChainIds`
  (which spans to close immediately, and the `jobBlocked` event payload) and
  `blockerChainTraceContexts` — which is _not_ the edge's `traceContext` but the **blocker chain's
  own**, aggregated from that chain's head. `blockerChain.completedAt` replaces the id list,
  `blockerChain.traceContext` replaces the aggregate. Conflating the two trace contexts would silently
  break cross-chain trace linkage.
- **`unblockJobs` emits one entry per edge, with an explicit `released` flag.** v2 returns two arrays
  of different cardinality: a trace context for _every_ edge pointing at the completing chain, but a
  job only for those that flipped — its `unblockedJobs` is the `UPDATE … RETURNING` set gated on
  `j.blocked = true`, i.e. exactly the jobs that **transitioned**. A job whose other blocker is still
  incomplete appears as an edge without transitioning, and `job_blocker`'s PK includes `index`
  precisely so a job may declare the same chain twice, so one job can appear on two entries. Per-job
  effects (`jobUnblocked`, the scheduled-job notify) key off `released`, not off iterating edges.

### 4.3 Locking: two rows, and a partial order

v2 implements `getChains({ lock })` as `FOR UPDATE` inside the tail `LATERAL`. That single lock does
**two** jobs: it serializes chain transitions, and — because `startJobAttempt` acquires with
`FOR UPDATE SKIP LOCKED` — it makes the tail invisible to acquisition. A chain-row lock alone recovers
only the first, so `lock: "exclusive"` must take **both** the `chain` row and the tail `job` row.

Splitting one lock into two creates an ordering problem v2 did not have, and it is a real one:
`refetchJobLocked` locks the job row and _then_ `finishJob` writes `chain`, while `completeChain`
calls `getChains({ lock })` then `getJobs({ lock })`. Those two orders are an ABBA deadlock. v3
declares:

> **`chain` rows before `job` rows; within a tier, ascending by id.**

Consequences that must be honoured rather than assumed:

- `refetchJobLocked` takes the `chain` lock before the job row **when the transaction will write the
  chain** — attempt finalization. A heartbeat or a plain `execute` writes only the job, stays
  job-tier-only, and must **not** take the chain lock; otherwise every heartbeat exclusively locks
  the chain row.
- `deleteChains` locks jobs with `ORDER BY ctid` today — a _different_ consistent order, safe against
  itself but an inversion against every `ORDER BY id` path. It must move to chain rows ascending by
  chain id (after `cascade` expansion, itself sorted), then job rows ascending by job id.
- Identity claims are chain-tier: they conflict on `chain` rows, so folding **and sorting** the batch
  by key (§2) is part of the same order.
- **Job-tier-only paths are exempt.** `startJobAttempt`, `extendJobAttempt`, `rescheduleJobs` and
  `reclaimExpiredJobAttempt` lock only in the job tier, ascending by id, and can never be the leg that
  holds a job row and waits on a chain row — which is the property that matters, not "they take
  exactly one lock" (`rescheduleJobs` takes N).

**The order is partial, and the doc should not pretend otherwise.** Two transaction shapes cannot
honour it, and both are structural rather than fixable:

- **Atomic-mode attempts.** In atomic mode the acquisition transaction _is_ the finalization
  transaction: `startJobAttempt` takes the job-row lock as its first statement, and `finishJob` locks
  and writes `chain` at the end. Chain-first is not merely inconvenient there, it is impossible — the
  worker does not know which chain it has until `SKIP LOCKED` has already picked and locked a job.
  Staged mode _can_ comply, because its finalization transaction opens knowing the chain id.
- **Chain ids learned after a job lock.** A handler calling `continueWith({ blockers })` mid-attempt
  makes `addJobsBlockers` enter the chain tier long after the job lock was taken, so T1 on chain A can
  block on chain B while T2 on chain B blocks on chain A, both individually compliant. Client calls
  from inside `execute` have the same shape.

Both cycles exist in v2 as well — through the tail-job lock rather than a chain row — so v3 neither
creates nor closes them. The contract is therefore narrower than "one global order":

- The tier order is **mandatory** for transactions the library opens with the chain id already in
  hand: `completeChain`, `deleteChains`, staged-mode finalization, identity claims,
  `addJobsBlockers`' blocker-chain locks. Among those it removes every ordering-removable deadlock.
- Against the atomic-attempt shape it removes nothing, and a `40P01` is the answer: a deadlock is a
  **retryable** attempt failure, the job reschedules, the retry succeeds. Adapters must classify it as
  such — no `40P01` handling exists in the codebase today, so this is new work, and a deadlock
  surfacing as a permanent failure would be a regression.

This ordering belongs in the conformance suite, not only in prose — a deadlock here is intermittent
and load-dependent.

### 4.4 Client surface

`Chain.input` is still the head job's input, `Chain.output` still the tail job's output,
`Chain.completedAt` now reads `chain.completed_at` instead of the tail's — the same value, one fewer
derivation. `Job.chainTypeName` is hydrated from the paired chain. `chain.id === headJob.id` is
preserved by construction, so `getChain(id)`, `awaitChain(id)`, `deleteChain(id)` and every existing
id in a user's database keep working.

v3 introduces **no client method change of its own**. It has one hard precondition:
`DeduplicationOptions.excludeChainIds` must already be gone. It is a per-call snapshot exclusion, and
a static index predicate cannot express "match anything except these chain ids" — the same reason
[chain-identity.md](chain-identity.md) makes its removal a prerequisite of its own indexes. Removing
it requires [attempt-finalization-rework.md](attempt-finalization-rework.md).

`getChainsByIdentity` is a new **adapter** method: `{ key, scope }[]` resolved positionally to at most
one chain each, probing the index the scope names. It is surfaced to clients only if
[chain-identity.md](chain-identity.md) lands.

### 4.5 Accounting against the sibling designs

| design                                                     | v3 takes into core                                                                                                         | v3 leaves alone                                                                                                | what v3 changes for it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [chain-identity.md](chain-identity.md)                     | `identity_key` / `identity_scope` on `chain`; the two partial unique indexes                                               | the client vocabulary (`identity`, `created`), the global-vs-per-type key decision, `listChains({ identity })` | **Deletes two of its parts**: the `chain_index = 0` predicate and the whole `chain_completed_at` denormalization task. Its indexes move to a 330M-row table from a 1B-row one. Its `excludeChainIds` removal becomes v3's precondition.                                                                                                                                                                                                                                                                 |
| [minimize-listing-surface.md](minimize-listing-surface.md) | `job_blocker.created_at` and the `(blocked_by_chain_id, created_at, job_id)` keyset — a correctness fix, not a listing one | the narrowed list params, required `typeName`, one-sort-per-status, discovery and capped counts                | Its chain-side indexes move to `chain` and lose the `chain_index = 0` / tail-lateral machinery its index section spends most of its length on. `chainTypeName` on `listJobs` becomes a cross-table filter rather than a judgement call. **`independent` becomes coverable** via a `chain` column. Its required `typeName` is what lets §5's chain index set be entirely type-led, which is the difference between v3 relocating index entries and adding them — so it is a prerequisite, not a sibling. |
| [unbounded-blockers.md](unbounded-blockers.md)             | nothing                                                                                                                    | `job_blocker.blocked`, `unsealed_blockers`, `limit`/`hasMore`, system chains                                   | `chain.completed_at` replaces the tail subquery its `blocked` column was partly compensating for. Its fan-out batching is unaffected.                                                                                                                                                                                                                                                                                                                                                                   |
| [job-priority.md](job-priority.md)                         | nothing                                                                                                                    | `job.priority`, the expression index                                                                           | Nothing. `priority` is a step property and stays on `job`.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [state-snapshot-metrics.md](state-snapshot-metrics.md)     | nothing                                                                                                                    | the gauges, the package, the runner                                                                            | Its frontier CTE becomes a `chain` scan plus a PK join; the dedicated `job_chain_tail_idx` it depends on is unnecessary (§5).                                                                                                                                                                                                                                                                                                                                                                           |
| [partitioned-pg-adapter.md](partitioned-pg-adapter.md)     | nothing — **out of scope** (§8)                                                                                            | everything                                                                                                     | Its schema premise needs revisiting against a three-table model; §8 records two errors found along the way.                                                                                                                                                                                                                                                                                                                                                                                             |

---

## 5. Indexes

The `job` list is a delta against the **shipped** index set, so the comparison is against something
that exists.

**`chain`** (~330M rows at 1B jobs) — all new

| index                        | definition                                                                          | serves                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| primary key                  | `(id)`                                                                              | every by-chain-id read                                          |
| `chain_type_created_idx`     | `(type_name, created_at)`                                                           | type-scoped listing; loose-scan source for `listChainTypeNames` |
| `chain_type_running_idx`     | `(type_name, created_at) WHERE completed_at IS NULL`                                | running listing, running counts                                 |
| `chain_type_completed_idx`   | `(type_name, completed_at) WHERE completed_at IS NOT NULL`                          | type-scoped completed listing and retention                     |
| `chain_identity_any_idx`     | `UNIQUE (identity_key) WHERE identity_key IS NOT NULL AND identity_scope = 'any'`   | `scope: 'any'` claims and lookups                               |
| `chain_identity_running_idx` | `UNIQUE (identity_key) WHERE … identity_scope = 'running' AND completed_at IS NULL` | `scope: 'running'` claims and lookups                           |

The two identity indexes are tiny — entries only for chains that opted in. Neither covers
[chain-identity.md](chain-identity.md)'s `listChains({ identity })` history listing, since completed
`running`-scope occurrences fall out of both predicates; that path needs
`chain (identity_key, created_at)` and belongs to whichever design ships it.

**There is no untyped chain index, and that is a prerequisite, not an omission.** Every chain index
here leads with `type_name`, which only works because
[minimize-listing-surface.md](minimize-listing-surface.md) makes `typeName` a required parameter on
`listChains`. Under the shipped optional-`typeName` signature this table would need a
`(created_at)` and a `(completed_at) WHERE completed_at IS NOT NULL` on top — two more ~330M-entry
B-trees, which is the entire difference between v3 being a relocation and a net addition. The same
design also retires the one caller that would have needed the untyped completed index:
[builtin-cleanup.md](builtin-cleanup.md)'s "omitting `typeNames` sweeps all completed chains"
becomes a `listChainTypeNames()` fan-out, one type-scoped covered range per type, which is
[minimize-listing-surface.md](minimize-listing-surface.md)'s explicit position that there is no
privileged cross-type path. So v3 depends on listing minimization landing first (§9 Q4) — not for
its ergonomics but for its index budget.

The `job` listing indexes below are left at their shipped definitions because that same design
gives them the identical `type_name`-leading treatment; restating it here would be duplicating its
delta, not v3's.

**`job`** (~1B rows)

| index                      | v3                                                                                                | vs. shipped                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| primary key                | `(id)`                                                                                            | unchanged                                                                                        |
| `job_chain_position_idx`   | `UNIQUE (chain_id, position)`                                                                     | renamed from `chain_index_idx`                                                                   |
| `job_ready_idx`            | `(type_name, scheduled_at) WHERE blocked = false AND attempt_at IS NULL AND completed_at IS NULL` | unchanged                                                                                        |
| `job_pending_idx`          | `(scheduled_at) WHERE attempt_at IS NULL AND completed_at IS NULL`                                | unchanged                                                                                        |
| `job_running_idx`          | `(type_name, attempt_until) WHERE attempt_at IS NOT NULL AND completed_at IS NULL`                | unchanged; becomes `(type_name, attempt_at)` under [worker-liveness.md](worker-liveness.md) (§6) |
| `job_completed_idx`        | `(completed_at) WHERE completed_at IS NOT NULL`                                                   | unchanged                                                                                        |
| `job_idx`                  | `(created_at)`                                                                                    | unchanged                                                                                        |
| `job_continuation_idx`     | `UNIQUE (continued_to_id) WHERE continued_to_id IS NOT NULL`                                      | unchanged                                                                                        |
| `chain_head_idx`           | —                                                                                                 | **dropped**                                                                                      |
| `chain_tail_running_idx`   | —                                                                                                 | **dropped**                                                                                      |
| `chain_tail_completed_idx` | —                                                                                                 | **dropped**                                                                                      |
| `job_deduplication_idx`    | —                                                                                                 | **dropped**                                                                                      |

**`job_blocker`**

- `PRIMARY KEY (job_id, blocked_by_chain_id, index)` — unchanged from the shipped composite PK
- `job_blocker_chain_idx (blocked_by_chain_id, created_at, job_id)` — one index serving both the
  unblock scan and the `listBlockedJobs` keyset

The remaining-blockers probe needs no index of its own — `(job_id)` is a prefix of the primary key.

### Index-entry accounting, honestly

Dropped from `job`: `chain_head_idx` (~330M entries), `chain_tail_completed_idx` (~330M),
`chain_tail_running_idx` (active chains only), `job_deduplication_idx` (keyed chains only).

Added, at full ~330M-entry size: `chain_type_created_idx`, `chain_type_completed_idx`, and
**`chain`'s primary key** — the last of which has no v2 counterpart, because in v2 the chain's
identity _was_ the job PK entry it already had. `chain_type_running_idx` covers active chains only;
the two identity indexes carry entries only for chains that opted in.

Total index entries **grow**, by roughly one 330M-entry B-tree. What improves alongside is placement
and write frequency: entries move from a table taking four-plus writes per row to one taking two or
three, the 1B-row table
sheds four predicates it evaluated on every insert and every completion, and retention's dead index
entries land on the smaller table.

### Queries that get structurally cheaper

- **Chain listing** — filter and order entirely within `chain`, then hydrate head and tail by primary
  key. No `WHERE chain_index = 0`, no `LEFT JOIN LATERAL … ORDER BY position DESC LIMIT 1`.
- **Identity claim and lookup** — a static partial unique index on the table the key describes, with
  neither of [chain-identity.md](chain-identity.md)'s two compensating predicate terms.
- **Chain-frontier reads** — [state-snapshot-metrics.md](state-snapshot-metrics.md) finds each running
  chain's frontier with a CTE over `job WHERE continued_to_id IS NULL AND completed_at IS NULL`,
  backed by a dedicated partial index. In v3 the frontier is _addressable_ (`chain.tail_job_id`), so
  the scan is `chain` plus a PK join and `job_chain_tail_idx` is unnecessary. The join itself is not:
  `running_chains{type, state}` still needs the tail's `blocked`/`attempt_at`/`scheduled_at`.
- **Retention** — the scan is a covered range on `chain_type_completed_idx`, one type at a time,
  rather than a tail-derived predicate over the job table,
  and `chain.job_count` makes each chain's delete size known before the transaction opens. This is the
  path that matters most without partitioning, because `DELETE` is the only retention mechanism there
  is.
- **Blocker registration** — `addJobsBlockers` today resolves each blocker chain's tail and takes
  `FOR UPDATE` on it; v3 reads `chain.completed_at`. **The lock is not optional and must be carried
  over** — it serializes registration against the blocker chain completing, and without it
  `addJobsBlockers` can read `completed_at IS NULL`, mark the job blocked, and lose the race with a
  concurrent completion whose `unblockJobs` already scanned `job_blocker`, leaving the job blocked
  forever. v3 takes `FOR UPDATE` on the blocker `chain` rows, ordered by chain id, inside §4.3's chain
  tier.
- **Type discovery** — the loose index scan for `listChainTypeNames` walks `chain`, whose distinct
  values it is actually asking about, instead of a partial index on `job`.

---

## 6. Write-path consequences, and what HOT can and cannot do here

Splitting the table changes which updates can be heap-only tuples, and — more usefully — lets the two
tables be tuned as the different workloads they are. It is worth being precise about the limit,
because "make the frequent updates HOT" is mostly **not available** on `job`, for a structural
reason.

### Why `job` updates are almost never HOT

A PostgreSQL update is HOT only if no column referenced by _any_ index — key columns and partial-index
predicate columns alike — changes, and the new version fits on the same page. In this schema every
job state transition is _defined_ by writing a column that some partial index predicates on. That is
not an accident; it is the mechanism that keeps the hot indexes partial on the active subset, which is
§1's whole answer to 1B rows.

| transition                     | writes                                      | HOT? | why                                                              |
| ------------------------------ | ------------------------------------------- | ---- | ---------------------------------------------------------------- |
| claim (`startJobAttempt`)      | `attempt_at`, `attempt_by`, `attempt_until` | no   | must leave `job_ready_idx`, must enter `job_running_idx`         |
| heartbeat (`extendJobAttempt`) | `attempt_until`                             | no   | `attempt_until` is a key column of `job_running_idx`             |
| attempt failure                | `attempt_at → NULL`, `last_attempt_*`       | no   | must re-enter `job_ready_idx`                                    |
| completion                     | `completed_at`, `output`                    | no   | must leave three partial indexes, must enter `job_completed_idx` |
| unblock                        | `blocked → false`                           | no   | must enter `job_ready_idx`                                       |

Four of these five are non-HOT **because they must be** — a transition that did not move the row
between indexes would be a transition acquisition could not see. Chasing HOT on them means giving up
the partial indexes, which costs far more than it saves.

The exception is the heartbeat, and it is the one that matters most.

### The heartbeat is the highest-frequency write in the system, and it is pure overhead

`extendJobAttempt` writes exactly one column, `attempt_until`, every `heartbeatMs` (30 s by default)
per running job, for the entire duration of every attempt. It carries no state transition at all — it
re-asserts one that already happened. Because `attempt_until` is a key column of `job_running_idx`, it
is non-HOT, and a non-HOT update writes a new index entry into **every index the new version
qualifies for**, not merely the ones naming the changed column. For a running job that is the primary
key, `job_idx (created_at)`, and `job_running_idx` — two of which are ~1B-entry structures whose
insert positions are effectively random, so each heartbeat dirties pages scattered across tens of
gigabytes of index.

At 10k concurrent attempts and a 30 s heartbeat that is ~333 dead tuples per second on the largest
table in the database — ~29M per day — produced by a system that may be creating no jobs at all. It is
the one write in the design whose cost is proportional to _concurrency times duration_ rather than to
work performed.

**The fix is not on this document's side of the boundary.** The lease is asserting that the _worker
process_ is alive, once per job, on a table that has 1B rows. Moving it to one row per worker removes
the write entirely rather than making it cheaper, and drops `attempt_until` from `job` — which turns
`job_running_idx` into `(type_name, attempt_at)`, an index over a **write-once** column, so the job
row acquires no writes at all between claim and finish. [worker-liveness.md](worker-liveness.md)
carries that design, including why the current per-job lease is not a timeout and why the reclaimer's
`ignoredJobIds` parameter is the existing code admitting the granularity is wrong.

It is independent of this document and can land first. Two cheaper mitigations exist if it does not,
neither requiring a schema change:

1. **Make renewal conditional.** Today `heartbeatMs` and `timeoutMs` are independent: the loop writes
   unconditionally on every tick, so the write rate is pinned at `runningJobs / heartbeatMs` and
   _raising `timeoutMs` does not reduce it_. Adding `AND attempt_until < $threshold` to the `UPDATE`
   makes a tick a zero-row no-op when the lease is still comfortably long, which turns `timeoutMs`
   into the write-rate lever it reads like.
2. **Batch renewals per worker.** A worker running _n_ attempts currently opens _n_ transactions, each
   a `SELECT … FOR UPDATE` plus an `UPDATE`. One `UPDATE … WHERE id = ANY($1) AND attempt_by = $2` per
   tick collapses that to one round trip and one transaction (ids sorted ascending, per §4.3). It does
   not reduce dead tuples, only transaction and WAL overhead — but that overhead is the larger term at
   high concurrency. Worth checking whether the `FOR UPDATE` is needed at all here: the `UPDATE`'s own
   `attempt_by` guard is already atomic, and the lock exists to produce typed errors that a zero-row
   result could produce instead.

### Per-table storage tuning, which is a v3 dividend in itself

`chain` and `job` have opposite write profiles, and in v2 they are the same table and must share one
set of storage parameters. Separating them makes each tunable:

- **`fillfactor` on `chain`, not on `job`.** The continuation update (`tail_job_id`, `job_count`)
  touches no indexed column, so it is HOT-eligible — but only while its page has free space, which at
  the default `fillfactor = 100` it will not have. Lowering it to ~85 on `chain` buys real HOT updates
  for the cost of ~15% of a ~330M-row table. Doing the same on `job` would cost ~15% of the 1B-row
  table and buy nothing, because none of its updates are HOT-eligible in the first place. v2 cannot
  make these two choices separately.
- **Autovacuum thresholds.** `job`'s default `autovacuum_vacuum_scale_factor = 0.2` means the first
  autovacuum on a 1B-row table waits for ~200M dead tuples — useless. It needs
  `scale_factor = 0` with a fixed `threshold`, and its own cost-limit budget. `chain` accumulates dead
  tuples at a different rate and does not want the same aggression. Again: one table, one setting, in
  v2.
- **`toast_tuple_target`.** `input` and `output` live on `job`; the `chain` row is narrow and fixed.
  Only the job table has a payload-size question to answer.

None of this is v3's justification — it is a consequence worth naming, because "we can finally tune
the 1B-row table for what it actually is" is a durable benefit that outlives the specific columns
being moved.

---

## 7. What this costs

- **Two inserts per chain creation** instead of one. Expressible as one CTE statement
  (`WITH c AS (INSERT INTO chain … RETURNING id) INSERT INTO job …`), but it is two heap inserts and
  two index sets — roughly +33% insert rows at an average chain length of 3.
- **Two extra row updates per chain lifecycle.** The continuation update is HOT only while the page
  has room; the completion update is never HOT and rewrites an entry in every `chain` index the new
  version qualifies for, the primary key included.
- **A join on every job read.** Always a primary-key lookup, and often free on write paths where the
  chain row is already dirty — but `listJobs` of 20 rows now touches 20 chain rows, and
  `startJobAttempt` adds an index descent plus a heap fetch to the hot path. §1.1 does **not** claim
  acquisition gets cheaper; this must be measured against `processing-capacity` before merging. The
  shipped `listJobs({ chainTypeName })` filter degrades further: answered from the job heap row today,
  a per-row join with no index that can lead it in v3.
- **New lock and statement costs on create.** One extra row lock per locked chain read and one per
  staged-mode finalization (§4.3); a wait — and, with `DO UPDATE`, a lock held to the caller's commit —
  on every _deduplicating_ create where v2 took none, making batch claim ordering load-bearing; and
  either a batch split by scope or a `withSavepoint` round trip, because `ON CONFLICT` infers one
  index (§2).
- **One more row to delete per chain at retention.** `DELETE`-based cleanup now removes the chain row
  as well as its jobs. Marginal against the job rows it already deletes, and partly offset by the four
  index-entry sets no longer dying on the job table — but it is not free, and without partitioning
  retention is the only lever there is.
- **Net index entries grow** (§5), by roughly one 330M-entry B-tree.
- **Three cross-table invariants that only code maintains.** `chain.tail_job_id` points at the job
  with `continued_to_id IS NULL`; `chain.completed_at` is set exactly when that job completes;
  `chain.job_count` matches the row count. Each is written in the same transaction as the transition
  that changes it, so they cannot drift under normal operation — but v2 had _derivations_ here, which
  cannot drift at all. Conformance must assert them rather than trust the shape.
- **A wider `StateAdapter` contract.** Every job-returning method changes shape, across three adapters
  and the conformance suite. This is the largest mechanical cost of the design.
- **A hard migration.** Chains must be materialized from existing `chain_index = 0` rows into a new
  table while workers keep minting v2-shaped rows. The `20260622…_job_model_v2` sequence
  (add columns → batched backfill → lock-and-cut → concurrent index rebuild) is the precedent, but the
  cut is wider: a v2 worker writing a job row without a `chain` row is not stale, it is a foreign-key
  violation.

The through-line: v3 trades measurable cost on the **create, continue and complete** paths for
structural wins on the **list and retain** paths, and is roughly neutral on **acquisition**. That
trade is correct only if reads and retention are the pressure — which is what "1B rows" means. At 1M
rows v2 is the better model and should stay.

---

## 8. Partitioning is deliberately out of scope

v3 makes no accommodation for [partitioned-pg-adapter.md](partitioned-pg-adapter.md). No column,
index, primary key or method signature here is shaped by it. That is a change from an earlier draft of
this design, and the reason is that anticipating it cost more than it bought: a denormalized
`job_chain_id` on `job_blocker` plus a rule that every blocker access path thread a chain id, a
composite `job` primary key that de-indexes bare-id lookups on the attempt path, and composite foreign
keys — all to serve an adapter that does not exist and may never be needed. 1B rows is a lot of data;
it is not, on its own, a reason to partition. Partitioning is deployment shape, which is exactly what
that document already says about itself.

Two findings are worth recording, because they surfaced while exploring it and they belong to that
document rather than this one:

1. **Its `PRIMARY KEY (id)` on a `chain_id`-partitioned `job` is illegal.** PostgreSQL requires every
   unique constraint on a partitioned table to include all partition key columns. The PK must become
   `(chain_id, id)`, which also reshapes `job_continuation_idx` and both self-FKs, and leaves bare-`id`
   job reads — which are on the attempt path (`refetchJobLocked`, `extendJobAttempt`,
   `finishJobAttempt`), not just the dashboard — without a usable index unless one is added back per
   partition.
2. **Its claim that "the invariants that need DB-level enforcement all operate within a single chain"
   is false for identity keys**, which are cross-chain by definition. Partitioning silently degrades
   them to per-partition uniqueness, which is not deduplication. True of v2's placement and equally of
   v3's; the difference is only that v3 isolates it to two indexes on one small table.

If that adapter is ever built, v3 is a friendlier starting point than v2 — `chain.id` is both the
primary key and the natural range key, and the chain table is a third the size — but that is an
observation, not a design goal, and it should be re-derived against the schema of the day rather than
pre-paid for here.

---

## 9. Open questions

1. **Is the pairing invariant too broad?** `StateJobWithChain` from `extendJobAttempt` — a heartbeat
   producing no user-facing entity — is uniform but wasteful. `listChainJobs` and the two blocker
   methods are already carved out (§4.2), which weakens the uniformity argument; a benchmark on the
   heartbeat path could finish it off.
2. **Does `job_count` earn its place?** Free to maintain (same UPDATE as `tail_job_id`) and it answers
   "how big is this chain" before a delete — which is the one lever retention has without partitioning
   — but it is the one column here that is a cache rather than a fact, and the only one that can be
   _wrong_ rather than merely stale.
3. **`chain.id === headJob.id`, or independent ids?** Sharing preserves the public identity model and
   every existing id, at the cost of one value naming a row in two tables. Independent ids are cleaner
   in isolation and break every user's stored chain id. Sharing is the current call.
4. **Listing minimization is a hard prerequisite, so what happens if it does not land?** §5's chain
   index set is entirely `type_name`-led, which assumes
   [minimize-listing-surface.md](minimize-listing-surface.md) has made `typeName` required and has
   converted cleanup's untyped sweep into a `listChainTypeNames()` fan-out. If v3 shipped against the
   shipped optional-`typeName` signature it would need `(created_at)` and
   `(completed_at) WHERE completed_at IS NOT NULL` as well, and its index accounting stops being a
   relocation. The question is whether to state this as a build-order dependency or to have v3 narrow
   `listChains` itself — the latter puts a breaking listing change inside a storage release.
5. **Does [worker-liveness.md](worker-liveness.md) land before or after v3?** It is independent, but
   both change `job_running_idx` and both are `major`, so shipping them apart means rebuilding that
   index twice and two breaking releases where one would do. Landing it _first_ is tempting: it shrinks
   the job row by a column, removes the only mid-attempt write, and its migration is far smaller than
   v3's — so v3's benchmark against `processing-capacity` would then measure a job table that is
   already at its final write profile.
6. **Does the head job stay untruncatable?** `StateChainWithJobs` makes the head mandatory. A future
   `truncateChainJobs` for very long chains would have to preserve it, or the tuple needs a nullable
   head.
7. **Sequencing.** v3 requires `excludeChainIds` to be gone, which requires
   [attempt-finalization-rework.md](attempt-finalization-rework.md). The open part is whether
   [chain-identity.md](chain-identity.md) lands _before_ v3 or is folded _into_ it: landing it first
   means writing a `chain_completed_at` denormalization and two `chain_index = 0` predicates that v3
   immediately deletes. Folding is cheaper and makes one larger migration; the cost is that a single
   release changes both storage and vocabulary.
