# Job + job_blocker model

> **Baseline for**: [state-snapshot-metrics.md](state-snapshot-metrics.md), [job-priority.md](job-priority.md), [scheduled-at-floor.md](scheduled-at-floor.md).

## Problem

Three coupled smells in prior models, fixable together:

1. **`status` is a denormalized cache.** Every value is decidable from columns the schema already needs for other reasons (`completed_at`, `leased_until`, `has_open_blockers`, `succeeded_by_job_id`). Keeping a stored `status` column forces every writer to maintain two representations in agreement, and every domain extension (continued-vs-terminal, ready-vs-scheduled) forces an enum-domain migration.
2. **`output: null` overloaded as a handoff sentinel.** A job that handed off via `continueWith` is `status: 'completed'` with `output: null`. Codecs/validators can't distinguish "terminated with null output" from "handed off, output meaningless." The discriminator wants to be a stored FK column, not a polymorphic null.
3. **`chain_index` leaks through the public API.** It exists for SQL ordering and race prevention — none of which is a user concern. The user-facing relationship is "this job continues to that job," not "this job is at position N."

The fixes are coupled: the FK that disambiguates terminal vs handoff is the same FK that lets us drop `chain_index` from the public surface; the status derivation that drops the column also lets us split `'completed'` into two type-level variants without an enum migration.

## Schema

### `job` columns

```
id                              -- PK
type_name                       -- string
chain_id                        -- FK to job(id); root job has chain_id = id
chain_type_name                 -- string; root job's type_name, copied onto every row in the chain
chain_index                     -- int, monotonic position in chain (0 = root); SQL-internal
succeeded_by_job_id             -- FK NULL; set when this job handed off to a successor
input                           -- jsonb
output                          -- jsonb NULL; set on terminal completion only
created_at                      -- timestamp
scheduled_at                    -- timestamp; when this job is eligible for processing
has_open_blockers               -- boolean NOT NULL DEFAULT false; denormalized blocker readiness
leased_by                       -- string NULL; worker id of current lease
leased_until                    -- timestamp NULL; lease deadline (also gates "running")
completed_at                    -- timestamp NULL; set on any terminal event (output or handoff)
completed_by                    -- string NULL; worker id of completer
attempt                         -- int NOT NULL DEFAULT 0
attempts_since_user_reschedule  -- int NOT NULL DEFAULT 0; ++ on each acquire; reset to 0 on user-initiated reschedule and on unblock (the row resuming after a blocked window starts a fresh streak)
last_attempt_error              -- jsonb NULL
last_attempt_at                 -- timestamp NULL
deduplication_key               -- string NULL
trace_context                   -- string NULL
chain_trace_context             -- string NULL
```

No `status` column. No `job_status` enum type (on PG). `chain_index` stays in storage but is hidden from the public API surface — it exists purely to make the SQL fast and safe (range scans for chain listing, `UNIQUE (chain_id, chain_index)` for race prevention).

### `job_blocker` columns

```
job_id                          -- FK; the gated job
blocked_by_chain_id             -- FK; the chain to wait for (= chain root's id)
ordinal                         -- int; display/trace order
trace_context                   -- string NULL
PRIMARY KEY (job_id, blocked_by_chain_id)
```

No `open` boolean on `job_blocker` — the chain-tail partial index gives O(1) "is this blocker resolved" without it, and the per-row maintenance cost isn't worth the query simplification (see [Why has_open_blockers but not job_blocker.open](#why-has_open_blockers-but-not-job_blockeropen)).

## Status model

### Public type

Single field, six values, discriminated union; each value names exactly one state and carries exactly the data meaningful in that state:

```ts
type Job<TJobId, TJobTypeName, TChainTypeName, TInput, TOutput, TCanContinue extends boolean> = {
  id: TJobId;
  chainId: TJobId;
  typeName: TJobTypeName;
  chainTypeName: TChainTypeName;
  input: TInput;
  createdAt: Date;
  scheduledAt: Date;
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
} & (
  | { status: "blocked"; openBlockerChainIds: TJobId[] }
  | { status: "scheduled" }
  | { status: "ready" }
  | { status: "running"; leasedBy: string; leasedUntil: Date }
  | (TCanContinue extends true
      ? {
          status: "continued";
          completedAt: Date;
          completedBy: string | null;
          succeededByJobId: TJobId;
        }
      : never)
  | ([TOutput] extends [never]
      ? never
      : { status: "completed"; completedAt: Date; completedBy: string | null; output: TOutput })
);
```

Distinctions resolved vs. the prior model:

- `'pending'` (which collapsed "ready now" and "scheduled for later") splits into `'ready'` and `'scheduled'`.
- `'completed'` (which collapsed "chain terminus" and "handoff") splits into `'completed'` (terminal, carries `output`) and `'continued'` (handoff, carries `succeededByJobId`).
- `'blocked'` carries the open blocker chain ids inline — the type-level surface tells the user _what_ is blocking, not just _that_ something is.

### Derivation rule

Computed at read time in each adapter's row mapper:

```ts
function deriveStatus(row, now): JobStatus {
  if (row.completed_at !== null && row.succeeded_by_job_id !== null) return "continued";
  if (row.completed_at !== null) return "completed";
  if (row.leased_until !== null) return "running";
  if (row.has_open_blockers) return "blocked";
  if (row.scheduled_at > now) return "scheduled";
  return "ready";
}
```

Order encodes the legal precedence: completion (in either flavor) wins over a stale lease; an active lease wins over a runtime-added blocker (a job in flight isn't gated by anything); an absolute gate (blockers) beats a time gate (`scheduled_at`); `scheduled` vs `ready` is the now() comparison.

`leased_until` (not `leased_by`) is the running-state gate. `leased_by` is attribution.

`completed_at` (not `output IS NOT NULL`) is the completion gate. A handler returning `complete(null)` legitimately writes `output = NULL`.

`status` is a **view, not a stored field** — semantically equivalent to a SQL `CASE` expression over the structural columns. `now` is a parameter of the derivation, not ambient global state: each query passes a single `now` (PG: `now()`, txn-stable; SQLite: `unixepoch()` materialized once into the SELECT; in-process: `Date.now()` once per call) so status is stable within a query and may change across queries — same contract as any time-dependent projection. Only the `scheduled`/`ready` flip depends on the clock; every other transition is driven by a write to a structural column.

### Chain status

Derived from the chain's tail (`succeeded_by_job_id IS NULL` for `chain_id = X`):

```ts
type ChainStatus = "open" | "closed";

function deriveChainStatus(tailRow): ChainStatus {
  return tailRow.completed_at !== null && tailRow.succeeded_by_job_id === null ? "closed" : "open";
}
```

Naming: `closed` is the antonym of `open` and abstracts over the terminal-completion path (today) plus any future terminal-non-success (cancellation, terminal failure) — those would all be substates of `closed`. The dedup `scope` becomes `'open' | 'any'` for consistency.

## SQL hot paths

```sql
-- Acquisition (hottest)
SELECT … FROM job
WHERE type_name = ANY($types)
  AND has_open_blockers = false
  AND leased_until IS NULL
  AND completed_at IS NULL
  AND scheduled_at <= now()
ORDER BY scheduled_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;

-- Reap expired leases
SELECT … FROM job
WHERE leased_until IS NOT NULL
  AND leased_until <= now()
  AND completed_at IS NULL
ORDER BY leased_until ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;

-- Open-chain frontier (the open tail). Hits `job_chain_tail_idx` (1 row).
SELECT … FROM job
WHERE chain_id = $1
  AND succeeded_by_job_id IS NULL
  AND completed_at IS NULL;

-- Any-chain tail (open or closed). Falls back to `job_chain_position_idx`
-- because closed tails are not in `job_chain_tail_idx`; the index range scan
-- on (chain_id) is bounded by chain length.
SELECT … FROM job
WHERE chain_id = $1 AND succeeded_by_job_id IS NULL;

-- Chain closed? (closed tail = terminal completion, no successor)
SELECT 1 FROM job
WHERE chain_id = $1
  AND succeeded_by_job_id IS NULL
  AND completed_at IS NOT NULL;

-- Blocker chain resolved? Same shape as "chain closed?"; the chain-tail
-- partial is open-only, so this query uses `job_chain_position_idx` on
-- (chain_id, chain_index). One chain-length range scan per blocker — still
-- O(1) per blocker since closed chains are short to walk in practice.
SELECT 1 FROM job
WHERE chain_id = $blocker_chain_id
  AND succeeded_by_job_id IS NULL
  AND completed_at IS NOT NULL;

-- Listing by computed status (dashboard)
-- Use a CASE in the projection; filter via the partial-index family in `Indexes`.

-- Cursor pagination within a chain (opaque-id cursor)
WITH start_row AS (
  SELECT n.chain_index
  FROM job c
  JOIN job n ON n.id = c.succeeded_by_job_id
  WHERE c.id = $cursorId
)
SELECT j.* FROM job j, start_row s
WHERE j.chain_id = $chainId AND j.chain_index >= s.chain_index
ORDER BY j.chain_index ASC
LIMIT $N + 1;
```

## Indexes

```sql
-- Acquisition
CREATE INDEX job_ready_idx ON job (type_name, scheduled_at)
  WHERE has_open_blockers = false
    AND leased_until IS NULL
    AND completed_at IS NULL;

-- Lease reap; also serves "running" filter
CREATE INDEX job_running_idx ON job (leased_until)
  WHERE leased_until IS NOT NULL AND completed_at IS NULL;

-- Chain frontier of OPEN chains (one row per open chain). UNIQUE encodes
-- "at most one open tail per chain." The `completed_at IS NULL` clause is
-- load-bearing: without it, `continueWith` cannot write atomically — see
-- [continueWith write order](#why-the-tail-partial-requires-completed_at-is-null).
CREATE UNIQUE INDEX job_chain_tail_idx ON job (chain_id)
  WHERE succeeded_by_job_id IS NULL AND completed_at IS NULL;

-- Chain ordered traversal + race prevention for continueWith
CREATE UNIQUE INDEX job_chain_position_idx ON job (chain_id, chain_index);

-- Dedup (open-scope, common case)
CREATE INDEX job_dedup_open_idx ON job (deduplication_key, created_at DESC)
  WHERE deduplication_key IS NOT NULL
    AND chain_id = id
    AND completed_at IS NULL;
-- `chain_id = id` is the structural "is a chain root" predicate (roots set
-- chain_id to their own id; non-roots inherit the root's id). Using it here
-- instead of `chain_index = 0` keeps chain_index out of read-side predicates
-- — chain_index remains for ordered range scans only.

-- Reverse-lookup: jobs blocked by a given chain
CREATE INDEX job_blocker_chain_idx ON job_blocker (blocked_by_chain_id);

-- Dashboard / state-snapshot listing partials
CREATE INDEX job_listing_idx ON job (type_name, created_at DESC);

CREATE INDEX job_blocked_listing_idx ON job (type_name, created_at DESC)
  WHERE has_open_blockers = true
    AND leased_until IS NULL
    AND completed_at IS NULL;

CREATE INDEX job_pending_listing_idx ON job (type_name, scheduled_at)
  WHERE has_open_blockers = false
    AND leased_until IS NULL
    AND completed_at IS NULL;
-- "Pending" here is the structural predicate "not blocked, not running, not
-- completed" — i.e. the union of the derived `ready` and `scheduled` statuses.
-- The derivation drops `pending` from the public vocabulary (it split into
-- `ready` and `scheduled`), but the partition itself is still the cheapest
-- thing to index on, and the now() split between `ready` and `scheduled` is
-- a runtime filter applied on top of the index-ordered scan. This index also
-- serves `getNextJobAvailableInMs` (priority-blind wake-up on min(scheduled_at)).

CREATE INDEX job_completed_listing_idx ON job (type_name, completed_at DESC)
  WHERE completed_at IS NOT NULL AND succeeded_by_job_id IS NULL;

CREATE INDEX job_continued_listing_idx ON job (type_name, completed_at DESC)
  WHERE completed_at IS NOT NULL AND succeeded_by_job_id IS NOT NULL;
-- Split on the variant discriminator: a completion is either terminal or
-- handoff, never both, so per-write only one partial is touched. Dashboard
-- filters for either variant get an exact partial instead of a row-inspection
-- scan over a mixed partition.

-- Chain listing (root jobs only, by chain type)
CREATE INDEX chain_listing_idx ON job (chain_type_name, created_at DESC)
  WHERE chain_id = id;
```

Properties:

- Every index is partial on the active subset, the completed subset, or a structurally meaningful slice. No index covers the full table.
- The `job_chain_tail_idx` UNIQUE encodes an actual invariant: **at most one row per chain has no successor.** Today's `chain_index`-based schema can't express this directly; `succeeded_by_job_id` makes it a DB-enforced constraint.
- Status-based dashboard filters hit per-status partials; the acquisition / running / dashboard-listing partials together cover every status without a stored `status` column.

## Public API contract

### State adapter (`StateJob`)

```ts
type StateJob = {
  id: string;
  typeName: string;
  chainId: string;
  chainTypeName: string;
  input: unknown;
  output: unknown;

  succeededByJobId: string | null;
  hasOpenBlockers: boolean;

  status: JobStatus; // derived at read time; never stored
  createdAt: Date;
  scheduledAt: Date;
  completedAt: Date | null;
  completedBy: string | null;

  attempt: number;
  attemptsSinceUserReschedule: number;
  lastAttemptError: string | null;
  lastAttemptAt: Date | null;

  leasedBy: string | null;
  leasedUntil: Date | null;

  deduplicationKey: string | null;
  chainTraceContext: string | null;
  traceContext: string | null;
};
```

`chainIndex` is **not** on `StateJob` — it's a storage detail. The cursor for `listChainJobs` is opaque-id-based; the SQL resolves position internally via `chain_index`.

### Adapter methods

- `acquireJob({ typeNames, workerId, leaseDurationMs })` — writes `leased_by`, `leased_until`, `attempt++`, `attempts_since_user_reschedule++` atomically with row selection. With no stored `status` column, "running" is the presence of `leased_until`, so the lease must be set at acquire time.
- `completeJob({ jobId, workerId, output? })` — writes `completed_at`, `completed_by`, `output` (nullable; null when the parent's `succeeded_by_job_id` was set earlier by a `continueWith`-driven `createJobs`). Single unified method; the row's `succeeded_by_job_id` distinguishes terminal from handoff.
- `createJobs` per-job input is `{ kind: "chainStart" | "continueWith", ... }` — for `continueWith`, the adapter inherits `chain_id`, `chain_type_name`, derives `chain_index`, and sets the parent's `succeeded_by_job_id` in the same transaction.
- `rescheduleJob({ jobId, schedule, error, userInitiated })` — when `userInitiated = true`, sets `attempts_since_user_reschedule = 0`. Otherwise leaves it.
- `addJobsBlockers` sets `has_open_blockers = true` on dependents with ≥1 incomplete blocker; `unblockJobs` sets `has_open_blockers = false` and `attempts_since_user_reschedule = 0` when the last blocker resolves. The counter reset on unblock is deliberate: the row was off the active partition during the blocked window, and "stuck" only makes sense as a streak of consecutive failed acquires under runnable conditions. Coming back from blocked starts a new streak.

### `Job` discriminated union

See [Public type](#public-type) above. Six variants, each carrying just-right data.

## Why this is the irreducible model

### Why `has_open_blockers` (the acquisition benchmark)

`has_open_blockers` is the one denormalization that can't be eliminated. Benchmarked on Postgres 18 at 90k blocked / 10k pending, acquiring without denormalization (`NOT EXISTS (SELECT 1 FROM job_blocker … WHERE incomplete)`):

| shape         | with `has_open_blockers` | `NOT EXISTS` (no denormalization) |
| ------------- | ------------------------ | --------------------------------- |
| random        | 0.01 ms                  | 254 ms                            |
| blocked-front | 0.01 ms                  | 202 ms                            |
| pending-front | 0.01 ms                  | 193 ms                            |

A ~15,000–25,000× regression — the planner walks the full pending index probing `job_blocker` per row. ~800k buffer hits per acquire vs 3. No partial-index trick saves this: both PG and SQLite require partial-index predicates to be deterministic on the indexed row, ruling out `WHERE NOT EXISTS (…)`.

### Why `has_open_blockers` but not `job_blocker.open`

"Is this blocker resolved?" is a bounded-cost lookup via `job_chain_position_idx` (range scan over a single chain, typically short). The chain-tail partial covers the open case in O(1) and the position index covers the closed-tail case in O(chain length). A per-blocker-row `open` boolean would only save aggregation in `unblockJobs`, which already operates on a bounded set (the dependents of the just-completed chain). The single denormalization on `job.has_open_blockers` is irreducible; the second one isn't.

### Why the tail partial requires `completed_at IS NULL`

A naive `WHERE succeeded_by_job_id IS NULL` predicate would deadlock the natural `continueWith` write. Walk through it:

1. State at tx start: J1 is the current tail (`succeeded_by_job_id IS NULL`, `completed_at IS NULL`). J1 occupies the partial-unique slot for `(chain_id = C)`.
2. The handler returns `continueWith({ ... })`. The adapter wants to INSERT J2 with `chain_id = C` and `succeeded_by_job_id IS NULL`, then UPDATE J1 to point at J2 and mark it completed.

With the naive predicate, step 2's INSERT immediately conflicts with J1 — both rows want the same partial-unique slot. Partial-unique indexes can't be `DEFERRABLE` in either Postgres or SQLite (deferrability is a constraint property; partial uniques are necessarily plain indexes), so there is no way to defer the conflict to end-of-statement. Single-statement CTE rewrites don't help either: data-modifying CTEs materialize their row mutations into the index as they run.

Adding `AND completed_at IS NULL` to the predicate fixes this by giving the writer a way to evict J1 from the partial before J2 enters:

1. UPDATE J1 SET `completed_at = $now` — J1 leaves the partial.
2. INSERT J2 with `succeeded_by_job_id = NULL` — J2 enters the partial, no conflict.
3. UPDATE J1 SET `succeeded_by_job_id = J2.id` — no partial impact (J1 already out).

All three statements live inside the `continueWith` transaction; partial readers between them are not a concern (the tx is the only writer holding the row's lease). The invariant DB-side weakens from "at most one tail per chain" to "at most one open tail per open chain"; the stronger app-level invariant ("exactly one tail per chain at all times") is maintained by the same single write site (`continueWith → createJobs`) and the `(chain_id, chain_index)` UNIQUE. Closed-chain tail lookups (rare; only `chain closed?` / `blocker chain resolved?`) fall back to `job_chain_position_idx`, costing one bounded range scan.

### Why `succeeded_by_job_id` stored (not derived via `chain_index + 1` lookup)

- **Disambiguates terminal vs handoff at the storage layer**, not via the `output IS NULL` sentinel.
- **Encodes the "at most one successor" invariant via partial UNIQUE index**, DB-enforced.
- **SQLite mutating-CTE problem**: SQLite doesn't support `UPDATE … RETURNING *` joined back to a SELECT. Deriving the field on every read means ~13 SELECT sites each gaining a follow-up query in the SQLite adapter.
- **Single write site** (`continueWith` → `createJobs`), so drift surface is small and bounded by one CTE.

### Dead-tuple churn

Most state transitions on `job` are non-HOT: every transition touches a column (`leased_until`, `completed_at`, `scheduled_at`, `has_open_blockers`) that appears in at least one partial-index predicate, and PG treats predicate columns as "indexed" for HOT eligibility. A typical job lifecycle generates ~2–3 dead tuples on `job` (acquire + complete, plus one per retry / unblock / continueWith). At sustained throughput this is real index churn — but on PG ≥14 it is carried by engine features, not by schema design.

What carries it:

- **VM-aware vacuum (PG 9.6+)** skips all-visible pages on the heap scan. Cold completed history doesn't get re-scanned just because it's there — only pages that saw recent writes are touched. The autovacuum heap scan cost is bounded by the active set, not the table size.
- **Bottom-up index deletion (PG 14+)** removes dead/duplicate index entries opportunistically when leaf pages fill, so index bloat from update churn largely self-heals on writes rather than waiting for `vacuum_index_cleanup`.
- **`INDEX_CLEANUP = AUTO` (PG 14+, default)** skips the index-vacuum pass entirely when the heap pass found few dead tuples.

V1 commitment: **set autovacuum to threshold-based pinning and trust the engine.** Target shape:

```sql
ALTER TABLE {{schema}}.{{table_prefix}}job SET (
  fillfactor = 75,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_vacuum_cost_delay = 0
);
```

Threshold-based pinning (`threshold = 5000, scale_factor = 0`) gives a predictable vacuum cadence regardless of table size — a fixed dead-tuple budget per pass. The historical `scale_factor` knob anchored the trigger to table growth, but on modern PG (VM-aware vacuum) the scan cost no longer scales with the table, so anchoring the trigger to it just delays vacuum on big tables. A future cleanup-style job can dynamically `ALTER TABLE … SET (autovacuum_vacuum_threshold = …)` per deployment if a single static value isn't right.

Current migration `20240102000000_vacuum_tuning` uses `scale_factor = 0.02`; switching it to threshold-based pinning is a follow-up migration step in the job-model alignment EPIC.

PG ≥14 is the supported floor for this workload model. PG 13 reaches end-of-life in November 2025; we don't carry the pre-14 vacuum profile in the design.

Add a dead-tuple-rate gauge in [state-snapshot-metrics.md](state-snapshot-metrics.md)'s follow-up so operators can see if this ever does become the bottleneck.

### Partition-friendliness on `chain_id`

The schema is deliberately structured so a future partitioned PG adapter can range-partition `job` on `chain_id` without schema rework: `chain_id` is immutable from insert (no row moves), self-FKs are chain-local (partition-local lookups), and the chain-scoped uniqueness invariants hold within a partition. Deployment shape, not core schema concern — see [partitioned-pg-adapter.md](partitioned-pg-adapter.md) for the full design.

### Why no stored `status` column

Every value is a function of structural columns; writes touching multiple representations are drift-prone; enum-domain migrations are heavy (PG `ALTER TYPE ADD VALUE`, SQLite CHECK rewrite via `writable_schema`); the public vocabulary can evolve without renegotiating storage. Read-time derivation via row mapper or SQL CASE is cheap on bounded partial-index partitions.

### Why `chain_index` stays in storage (hidden from API)

Provides: (a) cheap range-scan ordering for chain listing, (b) `UNIQUE (chain_id, chain_index)` for race prevention on `continueWith`. Replacing range scans with recursive CTEs over `succeeded_by_job_id` is order-of-magnitude slower on cold cache. Keep `chain_index` as an SQL-internal ordering primitive; the public API surfaces `succeeded_by_job_id` instead.

The "is this a chain root?" predicate uses `chain_id = id` (roots set `chain_id` to their own id; non-roots inherit the root's id), not `chain_index = 0`. Both are correct; `chain_id = id` is preferred because it keeps `chain_index` out of read-side index predicates — its only remaining roles are ordering and uniqueness.

## Migration from current state

Delta to apply against the live `dev` branch (PG + SQLite migrations, in order):

1. **Add `has_open_blockers boolean NOT NULL DEFAULT false`.** Backfill: `true` where `status = 'blocked'`, `false` otherwise.
2. **Add `succeeded_by_job_id {{id_type}} NULL REFERENCES job(id)`.** Backfill from `chain_index`: for every non-tail row of every chain, set `succeeded_by_job_id` to the row with the same `chain_id` and `chain_index = self.chain_index + 1`. (Tails — including roots of single-job chains — stay `NULL`.) On PG: single `UPDATE … FROM` correlated by `(chain_id, chain_index+1)`. On SQLite: same shape via correlated subquery.
3. **Add `attempts_since_user_reschedule integer NOT NULL DEFAULT 0`.** No backfill (no historical data to recover; existing rows default to `0`, which conservatively reads as "no auto-retry streak yet" — same answer the metrics layer would give for a brand-new row).
4. **Drop the stored `status` column and (on PG) the `job_status` enum type.** Replace every read site with the derivation rule in [Derivation rule](#derivation-rule); every writer that previously maintained `status` is removed in the same change. The acquisition lease must be set in the same transaction that selects the row (since "running" is now `leased_until IS NOT NULL`).
5. **Create `job_chain_tail_idx UNIQUE` partial** on `(chain_id) WHERE succeeded_by_job_id IS NULL AND completed_at IS NULL`. The backfill from step 2 leaves at most one open tail per chain (closed chains end with a row whose `completed_at IS NOT NULL`, which is outside the partial), so the unique constraint is satisfied at creation time. The `completed_at IS NULL` clause is required for the `continueWith` write to be conflict-free — see [Why the tail partial requires completed_at IS NULL](#why-the-tail-partial-requires-completed_at-is-null).
6. **Rebuild status-dependent indexes against structural predicates**, replacing the `WHERE status = '…'` partials with the predicates from [Indexes](#indexes):
   - `job_acquisition_idx` → `job_ready_idx` (`WHERE has_open_blockers = false AND leased_until IS NULL AND completed_at IS NULL`).
   - `job_expired_lease_idx` → `job_running_idx` (`WHERE leased_until IS NOT NULL AND completed_at IS NULL`).
   - `job_listing_status_idx` is dropped; replaced by the per-status listing partials (`job_blocked_listing_idx`, `job_pending_listing_idx`, `job_completed_listing_idx`, `job_continued_listing_idx`) that match the derivation.
   - `job_listing_type_name_idx` keeps its shape but is renamed `job_listing_idx` (kept on the full table — the per-status partials handle filtered queries).
7. **Adjust the dedup partial** (`job_deduplication_idx`) to add the `completed_at IS NULL` predicate (open-scope) and swap the existing `chain_index = 0` clause for `chain_id = id`. Both clauses are equivalent on existing data (the backfill from step 2 leaves roots at `chain_id = id, chain_index = 0` and non-roots at `chain_id = root.id, chain_index > 0`); preferring `chain_id = id` keeps `chain_index` out of read-side index predicates.
8. **Rename `ChainStatus`** in the public API from the current vocabulary to `'open' | 'closed'`; the dedup `scope` becomes `'open' | 'any'`.

No data loss: every value the old `status` column carried is reconstructible from the structural columns after steps 1–2.

`chain_index` stays on the row indefinitely. It is already SQL-internal (not on `StateJob`); removing the column entirely would force chain-listing queries onto recursive CTEs over `succeeded_by_job_id` (slow on cold cache) and would lose the dedup-root predicate. The column is the cheapest way to express "ordered position in chain" — we keep it.

## Compatibility with other designs

### `state-snapshot-metrics.md`

Depends on:

- **Derived `status` as a labelable thing for gauges.** This design provides it; metrics queries compute status via CASE over the active partition or filter via the per-status listing partials.
- **`attempts_since_user_reschedule` column** for stuck-job gauges. Added by this design (maintained directly as a counter: `++` on each acquire, reset to `0` on user-initiated reschedule). Stuck-detection queries become `WHERE attempts_since_user_reschedule >= $threshold` with no projection arithmetic.
- **Active-partition partial indexes** so metrics scans don't touch completed history. Provided by `job_pending_listing_idx`, `job_blocked_listing_idx`, `job_running_idx`, `job_chain_tail_idx` — together they cover every "incomplete" slice the metrics layer needs.

`state-snapshot-metrics.md` should remove its schema-change section (the column add is now here) and reference this doc for the derivation rule and underlying indexes; metrics-specific indexes (if any beyond what's here) remain in that doc.

### `job-priority.md`

Adds `priority INTEGER NOT NULL DEFAULT 0` and changes the acquisition ORDER BY to `(priority - attempt) DESC, scheduled_at ASC` via an expression index.

Additive verification:

- **Acquisition partial predicate is unchanged.** The expression index built by job-priority retains our `WHERE has_open_blockers = false AND leased_until IS NULL AND completed_at IS NULL` partial — only the index columns change to include the demotion expression.
- **`getNextJobAvailableInMs` stays priority-blind** (per job-priority.md's own design), and our `job_pending_listing_idx` ordered by `scheduled_at` serves it directly.
- **`priority` column adds to the row**; `StateJob.priority` adds to the type. Doesn't intersect with any structural column this design defines.
- **In-process adapter SortedSet** comparator gains the demotion math. This design's in-process model is already a per-status set; job-priority refines the comparator on the same set.
- **No conflict with `succeeded_by_job_id` / `has_open_blockers` / status derivation** — priority is orthogonal to status and to the chain link.

job-priority lands as a strict extension: one column, one index swap, one comparator update.

## What this doesn't address

- **1M-blocker scaling** (per the old `add-job-blocker.md` proposal). Counter-style denormalization on `job` is ruled out by MVCC dead-tuple cost; an alternative denormalization on `job_blocker` (e.g. row-deletion-on-resolution) is orthogonal to this design and unsettled.
- **Runtime-added blockers** (`addJobBlocker` on a `running` row). The derivation rule's "running wins over blocked" precedence assumes blockers can't appear during execution. If runtime addition lands, the derivation needs a separate `runtime_blockers_count` field or similar; out of scope here.
- **Chain-level cancellation / terminal-failure**. `ChainStatus = 'open' | 'closed'` is shaped to accommodate these as `closed` substates later, but the substates themselves aren't designed here.
