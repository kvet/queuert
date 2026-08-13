# Job model v3 — the chain becomes a row

> **Status**: design. Breaking (`major`) across `@queuert/core` and all three state adapters.
> Supersedes the storage half of [chain-model.md](../docs/src/content/docs/advanced/chain-model.md).

v2 stores a chain as a **predicate over the job table** (`chain_index = 0` is the head,
`continued_to_id IS NULL` is the tail). v3 stores it as a **row**: three tables — `chain`, `job`,
`job_blocker` — where v2 has two.

Nothing above the `StateAdapter` boundary changes shape. `chain.id` is still the head job's id, the
Promise analogy still holds, and no client method changes signature on v3's account. v3 is a
**redistribution of the shipped schema**, not a feature.

**Partitioning is out of scope** — see §6.

---

## 1. Problem: the chain has no row of its own

What makes 1B rows survivable without partitioning is that every hot index is **partial** on the
active subset (`completed_at IS NULL`), so acquisition tracks the working set rather than lifetime
volume. v2 undermines this in one specific way: four of its indexes are chain-shaped but live on the
job table, so the highest-write table in the system maintains indexes for an entity it does not
store. Four consequences, all from the same root.

**Chain facts are denormalized onto every job.** `chain_type_name` and `chain_trace_context` are
copied onto every row because the worker and the entity mapper need them and there is nowhere else to
put them — roughly 80 B/row. At 1B jobs and an average chain length of 3 that is ~−80 GB off `job`
against ~+50 GB for a new `chain` table: a modest net win, and **not** the argument. The argument is
_where_ the bytes live — off the table that is scanned, locked, updated and vacuumed continuously,
onto one written two-to-three times per chain and then never touched.

**Mutable chain facts have no home at all.** Chain completion is derived from the _tail_
(`completed_at IS NOT NULL AND continued_to_id IS NULL`), so every chain read pays a tail resolution.
[chain-identity.md](chain-identity.md) then needs that fact **on the root** for its `running`-scope
partial unique index, so it introduces `chain_completed_at` — a third copy, written to a different
row of the same table. [minimize-listing-surface.md](minimize-listing-surface.md) calls `independent`
"the lone cross-table residual" and considers dropping it for that reason alone. Three separate
designs each work around the same missing row.

**Chain indexes live on the job table.** `chain_head_idx`, `chain_tail_running_idx`,
`chain_tail_completed_idx` and `job_deduplication_idx` exist purely to let `job` impersonate a chain
table. Their entry counts are chain-scale but they sit on the 1B-row table, so every job insert and
every completion evaluates their predicates. `chain_tail_*` are the worst: a continuation deletes one
entry and inserts another; a completion moves an entry between the two. And because retention is
`DELETE`-based, that is four more sets of dead index entries for autovacuum to reclaim on the 1B-row
table rather than the 330M-row one.

**Identity uniqueness needs compensating predicates.** chain-identity's core insight is right —
persist `scope` so the matching predicate is static and an index can enforce what a per-call `SELECT`
cannot ([#3](https://github.com/kvet/queuert/issues/3)). But on a single-table model every index
needs `chain_index = 0` to mean "chain", and the `running` scope needs the denormalized
`chain_completed_at` because the fact it wants lives on the tail. Neither term is about identity.

---

## 2. The shape

```
chain ──1:N──▶ job ──1:N──▶ job_blocker ──N:1──▶ chain
```

**`chain` — the control plane.** One row per chain: inserted once, updated once per continuation,
updated once at completion.

| column                           | notes                                                        |
| -------------------------------- | ------------------------------------------------------------ |
| `id`                             | PK. **Equals the head job's id** — public identity unchanged |
| `type_name`                      | was `chain_type_name`, on every job in v2                    |
| `created_at`                     | listing sort key                                             |
| `completed_at`                   | **stored, not derived**. NULL ⇒ `running`                    |
| `tail_job_id`, `job_count`       | advance together on `continueWith`; deliberately unindexed   |
| `identity_key`, `identity_scope` | was `deduplication_key`; scope persisted                     |
| `trace_context`                  | was `chain_trace_context`, on every job in v2                |

**`job` — the data plane.** Unchanged from v2 except: **drops** `chain_type_name`,
`chain_trace_context`, `deduplication_key`; **renames** `chain_index` → `position`; `chain_id` becomes
a real FK to `chain(id)` rather than a self-FK into `job(id)`.

**`job_blocker` — the dependency edge.** `blocked_by_chain_id` becomes a real FK to `chain(id)`, and
the table gains `created_at`.

### The rule that decides where a column lives

> A fact belongs on `chain` if it is true of the chain rather than of a step, **or** if it is read
> when no particular step is in hand. A fact belongs on `job` if a worker acquiring that step needs
> it.

`type_name`, `trace_context`, `completed_at`, `identity_*` → `chain`. `scheduled_at` and `attempt*`
→ `job`. The rule also settles what v3 does **not** ship: `blocker_ref_count` and a per-chain
`priority` both satisfy it, and v3 leaves the slot open rather than speculatively filling it — the
point is that v2 had nowhere to put them at all.

### Identity, with the workarounds deleted

```sql
UNIQUE (identity_key) WHERE identity_key IS NOT NULL AND identity_scope = 'any'
UNIQUE (identity_key) WHERE identity_key IS NOT NULL AND identity_scope = 'running'
                        AND completed_at IS NULL
```

`chain_index = 0` is gone because every row _is_ a chain. `chain_completed_at` is gone because
`completed_at` is the chain's own column. **This is the clearest illustration of what v3 is for**: it
does not replace [chain-identity.md](chain-identity.md)'s design, it removes the two predicate terms
that were paying rent for the missing table.

### `StateAdapter`: the pairing invariant

> **A job is never returned without its chain.**

`StateJob` no longer carries `chainTypeName`, so `mapStateJobToJob` cannot build the public `Job` from
a job row alone. Rather than reintroduce the denormalization for the mapper's convenience, every
job-returning method returns a composite — named subject-first, the entity the caller asked for at
element 0:

```ts
type StateChainWithJobs = [chain: StateChain, head: StateJob, tail: StateJob | undefined];
type StateJobWithChain = [job: StateJob, chain: StateChain];
```

The join is always a primary-key lookup, and on write paths the chain row is usually already in the
transaction's working set. Three deliberate departures: `getJobBlockers` and `unblockJobs` use records
with disambiguating field names (one returns the **blocker** chain, the other the **gated** job's
chain — a wider tuple would hide exactly the ambiguity this removes), and `listChainJobs` hoists the
chain out of the page rather than shipping 20 copies of it.

Two subtleties the shapes must carry: `addJobsBlockers` must return the **blocker chain** per edge,
because core consumes that chain's own trace context — not the edge's — and conflating the two
silently breaks cross-chain trace linkage. And `unblockJobs` must emit one entry per edge with an
explicit `released` flag, because v2 returns two arrays of different cardinality: a trace context for
every edge, but a job only for those that actually transitioned.

---

## 3. Locking: two rows, and a partial order

v2's `getChains({ lock })` takes `FOR UPDATE` inside the tail `LATERAL`. That single lock does **two**
jobs: it serializes chain transitions, and — because `startJobAttempt` acquires with
`FOR UPDATE SKIP LOCKED` — it hides the tail from acquisition. A chain-row lock alone recovers only
the first, so `lock: "exclusive"` must take **both** the `chain` row and the tail `job` row.

Splitting one lock into two creates an ordering problem v2 did not have: `refetchJobLocked` locks the
job then writes `chain`, while `completeChain` locks the chain then the job. That is an ABBA deadlock.
v3 declares:

> **`chain` rows before `job` rows; within a tier, ascending by id.**

Consequences that must be honoured rather than assumed: `refetchJobLocked` takes the chain lock only
when the transaction will write the chain (a heartbeat must stay job-tier-only, or every heartbeat
exclusively locks the chain row); `deleteChains` must move off its `ORDER BY ctid`, which is safe
against itself but an inversion against every `ORDER BY id` path; identity claims are chain-tier, so
batches must be folded **and sorted** by key.

**The order is partial, and the doc should not pretend otherwise.** Two shapes cannot honour it, both
structurally: in **atomic mode** the acquisition transaction _is_ the finalization transaction, and
the worker does not know which chain it has until `SKIP LOCKED` has already locked a job — chain-first
is impossible, not merely inconvenient. And a handler calling `continueWith({ blockers })` mid-attempt
enters the chain tier long after the job lock was taken, so two transactions can each be individually
compliant and still cycle. Both cycles exist in v2 too, so v3 neither creates nor closes them. The
contract is therefore narrower than "one global order": mandatory for transactions the library opens
with the chain id in hand, and against the atomic-attempt shape a `40P01` is the answer — a deadlock
is a **retryable** attempt failure. No `40P01` handling exists today, so that is new work, and a
deadlock surfacing as a permanent failure would be a regression.

This belongs in the conformance suite, not only in prose — a deadlock here is intermittent and
load-dependent.

---

## 4. Indexes

`job` **drops** all four chain-shaped indexes (`chain_head_idx`, `chain_tail_running_idx`,
`chain_tail_completed_idx`, `job_deduplication_idx`) and otherwise keeps its shipped set.

`chain` gains a primary key, `(type_name, created_at)`, `(type_name, created_at) WHERE completed_at
IS NULL`, `(type_name, completed_at) WHERE completed_at IS NOT NULL`, and the two identity indexes
above. `job_blocker` gains `(blocked_by_chain_id, created_at, job_id)`, serving both the unblock scan
and the `listBlockedJobs` keyset.

**Total index entries grow**, by roughly one 330M-entry B-tree — `chain`'s primary key has no v2
counterpart, because in v2 the chain's identity _was_ the job PK entry it already had. What improves
is placement and write frequency: entries move from a table taking four-plus writes per row to one
taking two or three, and the 1B-row table sheds four predicates it evaluated on every insert and
every completion.

**There is no untyped chain index, and that is a prerequisite, not an omission.** Every chain index
leads with `type_name`, which only works because
[minimize-listing-surface.md](minimize-listing-surface.md) makes `typeName` required on `listChains`
and converts cleanup's untyped sweep into a `listChainTypeNames()` fan-out. Under the shipped
optional-`typeName` signature `chain` would need two more ~330M-entry B-trees — which is the entire
difference between v3 being a relocation and a net addition.

### What gets structurally cheaper

- **Chain listing** — filter and order entirely within `chain`, then hydrate head and tail by primary
  key. No `WHERE chain_index = 0`, no `LEFT JOIN LATERAL … ORDER BY position DESC LIMIT 1`.
- **Retention** — a covered range scan on the completed index, one type at a time, and `job_count`
  makes each chain's delete size known before the transaction opens. This is the path that matters
  most without partitioning, because `DELETE` is the only retention mechanism there is.
- **Chain-frontier reads** — the frontier becomes _addressable_ (`chain.tail_job_id`), so
  [state-snapshot-metrics.md](state-snapshot-metrics.md)'s dedicated `job_chain_tail_idx` is
  unnecessary.
- **Blocker registration** — `addJobsBlockers` reads `chain.completed_at` instead of resolving each
  blocker chain's tail. **The `FOR UPDATE` is not optional and must be carried over** to the chain
  row: without it, registration can read `completed_at IS NULL`, mark the job blocked, and lose the
  race with a concurrent completion that already scanned `job_blocker` — leaving the job blocked
  forever.

### Per-table storage tuning is a dividend in itself

`chain` and `job` have opposite write profiles and in v2 must share one set of storage parameters.
Separated, `fillfactor ≈ 85` on `chain` buys real HOT continuation updates for ~15% of a 330M-row
table, while `job` — none of whose updates are HOT-eligible anyway — keeps `fillfactor = 100`.
Autovacuum thresholds and `toast_tuple_target` likewise stop being one compromise for two workloads.
Not v3's justification, but a durable benefit that outlives the specific columns being moved.

---

## 5. What this costs

- **Two inserts per chain creation** — roughly +33% insert rows at an average chain length of 3.
- **Two extra row updates per chain lifecycle.** The continuation update is HOT only while the page
  has room; the completion update is never HOT.
- **A join on every job read.** Always a primary-key lookup and often free on write paths, but
  `listJobs` of 20 rows now touches 20 chain rows and `startJobAttempt` adds an index descent plus a
  heap fetch to the hot path. v3 does **not** claim acquisition gets cheaper — this must be measured
  against `processing-capacity` before merging.
- **New lock and statement costs on create.** One extra row lock per locked chain read; a wait on
  every _deduplicating_ create where v2 took none; and either a batch split by scope or a
  `withSavepoint` round trip, because `ON CONFLICT` infers one index and a batch can carry both.
- **Three cross-table invariants that only code maintains** — `tail_job_id`, `completed_at` and
  `job_count`. Each is written in the same transaction as the transition that changes it, so they
  cannot drift under normal operation, but v2 had _derivations_ here, which cannot drift at all.
  Conformance must assert them rather than trust the shape.
- **A wider `StateAdapter` contract** across three adapters and the conformance suite. The largest
  mechanical cost of the design.
- **A hard migration.** Chains must be materialized from existing `chain_index = 0` rows while
  workers keep minting v2-shaped rows. The v2 migration sequence is the precedent, but the cut is
  wider: a v2 worker writing a job row without a `chain` row is not stale, it is an FK violation.

The through-line: v3 trades measurable cost on **create, continue and complete** for structural wins
on **list and retain**, and is roughly neutral on **acquisition**. That trade is correct only if reads
and retention are the pressure — which is what "1B rows" means. At 1M rows v2 is the better model and
should stay.

---

## 6. Partitioning is deliberately out of scope

No column, index, primary key or method signature here is shaped by
[partitioned-pg-adapter.md](partitioned-pg-adapter.md). An earlier draft did anticipate it, and it
cost more than it bought: a denormalized `job_chain_id` on `job_blocker`, a composite `job` primary
key that de-indexes bare-id lookups on the attempt path, and composite foreign keys — all for an
adapter that does not exist. 1B rows is a lot of data; it is not, on its own, a reason to partition.

Two findings belong to that document rather than this one:

1. Its `PRIMARY KEY (id)` on a `chain_id`-partitioned `job` is **illegal** — PostgreSQL requires
   every unique constraint on a partitioned table to include the partition key. The PK must become
   `(chain_id, id)`, leaving bare-`id` job reads (which are on the attempt path, not just the
   dashboard) without a usable index.
2. Its claim that "the invariants that need DB-level enforcement all operate within a single chain"
   is **false for identity keys**, which are cross-chain by definition. Partitioning silently
   degrades them to per-partition uniqueness, which is not deduplication.

---

## 7. Open questions

1. **Is the pairing invariant too broad?** `StateJobWithChain` from a heartbeat produces no
   user-facing entity. Three methods are already carved out, which weakens the uniformity argument.
2. **Does `job_count` earn its place?** Free to maintain and it sizes a delete before the transaction
   opens, but it is the one column here that is a cache rather than a fact — the only one that can be
   _wrong_ rather than merely stale.
3. **`chain.id === headJob.id`, or independent ids?** Sharing preserves the public identity model and
   every existing id, at the cost of one value naming a row in two tables. Sharing is the current
   call.
4. **What if listing minimization does not land?** §4's index set assumes required `typeName`.
   Without it, v3's accounting stops being a relocation. Either state it as a build-order dependency,
   or have v3 narrow `listChains` itself — which puts a breaking listing change inside a storage
   release.
5. **Does [worker-liveness.md](worker-liveness.md) land before or after?** Independent, but both
   change `job_running_idx` and both are `major`. Landing it first is tempting: it removes the only
   mid-attempt write, so v3's benchmark would measure a job table already at its final write profile.
6. **Does the head job stay untruncatable?** `StateChainWithJobs` makes the head mandatory; a future
   `truncateChainJobs` would have to preserve it.
7. **Does [chain-identity.md](chain-identity.md) land before v3, or fold into it?** Landing it first
   means writing a `chain_completed_at` denormalization and two `chain_index = 0` predicates that v3
   immediately deletes. Folding is cheaper and makes one larger migration; the cost is that a single
   release changes both storage and vocabulary.
