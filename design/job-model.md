# Job + job_blocker model

> **Baseline for**: [state-snapshot-metrics.md](state-snapshot-metrics.md), [partitioned-pg-adapter.md](partitioned-pg-adapter.md), [autovacuum-tuning.md](autovacuum-tuning.md).

## Problem

Three coupled smells in the prior model, fixable together:

1. **`status` is a denormalized cache.** Every value is decidable from columns the schema already needs for other reasons (`completed_at`, `leased_until`, `blocked`, `continued_to_job_id`). Keeping a stored `status` column forces every writer to maintain two representations in agreement, and any future domain extension (continued-vs-terminal, blocked-vs-runnable) forces an enum-domain migration.
2. **`output: null` overloaded as a handoff sentinel.** A job that handed off via `continueWith` is `status: 'completed'` with `output: null`. Codecs/validators can't distinguish "terminated with null output" from "handed off, output meaningless." The discriminator wants to be a stored FK column, not a polymorphic null.
3. **`chain_index` leaks through the public API.** It exists for SQL ordering and race prevention — none of which is a user concern. The user-facing relationship is "this job continues to that job," not "this job is at position N."

The fixes are coupled: the FK that disambiguates terminal vs handoff is the same FK that lets us drop `chain_index` from the public surface; the status derivation that drops the column also lets the completed state split into two type-level shapes (terminal vs continued) without an enum migration.

## Schema

### `job` columns

```
id                              -- PK
type_name                       -- string
chain_id                        -- FK to job(id); root job has chain_id = id
chain_type_name                 -- string; root job's type_name, copied onto every row in the chain
chain_index                     -- int, monotonic position in chain (0 = root); SQL-internal
continued_to_job_id             -- FK NULL; set when this job handed off to a successor
input                           -- jsonb
output                          -- jsonb NULL; set on terminal completion only
created_at                      -- timestamp
scheduled_at                    -- timestamp; when this job is eligible for processing
blocked                         -- boolean NOT NULL DEFAULT false; denormalized blocker readiness
leased_by                       -- string NULL; worker id of current lease
leased_until                    -- timestamp NULL; lease deadline (also gates "running")
completed_at                    -- timestamp NULL; set on any terminal event (output or handoff)
completed_by                    -- string NULL; worker id of completer
attempt                         -- int NOT NULL DEFAULT 0
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

No `open` boolean on `job_blocker` — the chain-tail partial index gives O(1) "is this blocker resolved" without it, and the per-row maintenance cost isn't worth the query simplification (see [Why `blocked` but not `job_blocker.open`](#why-blocked-but-not-job_blockeropen)).

## Status model

### Public type

Three top-level values; the runnable detail (`blocked`, `scheduled`) lives as attributes of `pending`, and the completed shape splits structurally on `continuedToJobId`. Discriminated union — each value names exactly one state and carries only the data meaningful in that state:

```ts
type Job<TJobId, TJobTypeName, TChainTypeName, TInput, TOutput, TCanContinue extends boolean> = {
  id: TJobId;
  chainId: TJobId;
  typeName: TJobTypeName;
  chainTypeName: TChainTypeName;
  input: TInput;
  createdAt: Date;
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
} & (
  | {
      status: "pending";
      scheduledAt: Date;
      blocked: boolean;
      // when blocked === true, the chains still gating this job:
      incompleteChainIds: TJobId[];
    }
  | { status: "running"; scheduledAt: Date; leasedBy: string; leasedUntil: Date }
  | ({ status: "completed"; completedAt: Date; completedBy: string | null } & (
      | ([TOutput] extends [never] ? never : { output: TOutput; continuedToJobId: null })
      | (TCanContinue extends true ? { output?: never; continuedToJobId: TJobId } : never)
    ))
);
```

Distinctions resolved vs. the stored-`status` model:

- `'pending'` is no longer split into separate `blocked` / `scheduled` enum values; both are attributes of the single `pending` state. `blocked` reflects the denormalized column; `scheduled` (if surfaced — see open question below) is the `scheduledAt > now()` comparison.
- `'completed'` (which collapsed "chain terminus" and "handoff") splits into two type-level shapes: terminal (`continuedToJobId === null`, carries `output`) and continued (`continuedToJobId` points at the successor, no `output`). The discriminator is the stored FK, not the `output IS NULL` sentinel.
- Each completed shape is gated by a type parameter, so the union never offers a structurally impossible terminus: the continued shape exists only when `TCanContinue extends true`, and the terminal shape collapses to `never` when `[TOutput] extends [never]` (a job that produces no output can't terminate _with_ one — its only completion is a handoff). The `[TOutput]` tuple wrap is deliberate: a naked `TOutput extends never` distributes over the empty union and would wrongly yield `never` for every `TOutput`.

> **Open question — surface `scheduled`?**
> The pending variant always carries `scheduledAt`. Whether it _also_ carries a derived `scheduled: boolean` (= `scheduledAt > now()`) is undecided. Arguments to drop it: it's pure derivation a caller can do from `scheduledAt`, and `now()` is query-relative so the boolean is only meaningful at read time anyway. Arguments to keep it: dashboards and the metrics layer want a labelable "is this waiting on the clock" without re-deriving. Default lean: **drop the boolean, expose `scheduledAt`** and let consumers compare. Revisit if the dashboard/metrics layer makes the derivation awkward.

> **Open question — `incompleteChainIds` on the pending variant.**
> The blocked detail lives at the public `Job` layer as `incompleteChainIds` (the still-open blocker chains). The state-adapter layer carries only the `blocked: boolean` column — the chain ids are resolved separately (via `getJobBlockers` / a join), not stored on the row. Note the **naming asymmetry**: the adapter's `addJobsBlockers` returns `incompleteBlockerChainIds`, while the public job surfaces `incompleteChainIds`. Decide whether to (a) inline `incompleteChainIds` on the pending variant (requires the resolver to always fetch blockers for blocked jobs), or (b) keep the public job at `blocked: boolean` and require callers to call `getJobBlockers` when they want the ids. Reconcile the naming either way.

### Derivation rule

Computed at read time in each adapter's row mapper:

```ts
function deriveStatus(row, now): JobStatus {
  if (row.completed_at !== null) return "completed"; // continued vs terminal via continued_to_job_id
  if (row.leased_until !== null) return "running";
  return "pending"; // blocked = row.blocked; scheduled = row.scheduled_at > now
}
```

Order encodes the legal precedence: completion (terminal or handoff) wins over a stale lease; an active lease wins over a runtime-added blocker (a job in flight isn't gated by anything). Everything that isn't completed or leased is `pending`; whether a pending job is blocked or waiting on the clock is read off `blocked` and `scheduled_at`.

`completed_at` (not `output IS NOT NULL`) is the completion gate. A handler returning `complete(null)` legitimately writes `output = NULL`; the terminal-vs-continued split is read off `continued_to_job_id`.

`leased_until` (not `leased_by`) is the running-state gate. `leased_by` is attribution.

`status` is a **view, not a stored field** — semantically equivalent to a SQL `CASE` expression over the structural columns. `now` is a parameter of the derivation, not ambient global state: each query passes a single `now` (PG: `now()`, txn-stable; SQLite: `unixepoch()` materialized once into the SELECT; in-process: `Date.now()` once per call) so status is stable within a query and may change across queries — same contract as any time-dependent projection. Only the pending `scheduled` reading depends on the clock; every other transition is driven by a write to a structural column.

### Chain status

Two values, matching the current vocabulary:

```ts
type ChainStatus = "running" | "completed";
```

Derived from the chain's tail (`continued_to_job_id IS NULL` for `chain_id = X`): the chain is `completed` when its tail is terminally completed (`completed_at IS NOT NULL AND continued_to_job_id IS NULL`), otherwise `running`.

The dedup `scope` stays `'incomplete' | 'any'` — unchanged.

## SQL hot paths

```sql
-- Acquisition (hottest)
SELECT … FROM job
WHERE type_name = ANY($types)
  AND blocked = false
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
  AND continued_to_job_id IS NULL
  AND completed_at IS NULL;

-- Any-chain tail (running or completed). Falls back to `job_chain_position_idx`
-- because completed tails are not in `job_chain_tail_idx`; the index range scan
-- on (chain_id) is bounded by chain length.
SELECT … FROM job
WHERE chain_id = $1 AND continued_to_job_id IS NULL;

-- Chain completed? (terminal tail = terminal completion, no successor)
SELECT 1 FROM job
WHERE chain_id = $1
  AND continued_to_job_id IS NULL
  AND completed_at IS NOT NULL;

-- Blocker chain resolved? Same shape as "chain completed?"; the chain-tail
-- partial is open-only, so this query uses `job_chain_position_idx` on
-- (chain_id, chain_index). One chain-length range scan per blocker — still
-- O(1) per blocker since completed chains are short to walk in practice.
SELECT 1 FROM job
WHERE chain_id = $blocker_chain_id
  AND continued_to_job_id IS NULL
  AND completed_at IS NOT NULL;

-- Listing by computed status (dashboard)
-- Use a CASE in the projection; filter via the partial-index family in `Indexes`.

-- Cursor pagination within a chain (opaque-id cursor)
WITH start_row AS (
  SELECT n.chain_index
  FROM job c
  JOIN job n ON n.id = c.continued_to_job_id
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
  WHERE blocked = false
    AND leased_until IS NULL
    AND completed_at IS NULL;

-- Lease reap; also serves "running" filter
CREATE INDEX job_running_idx ON job (leased_until)
  WHERE leased_until IS NOT NULL AND completed_at IS NULL;

-- Chain frontier of OPEN chains (one row per running chain). UNIQUE encodes
-- "at most one open tail per chain." The `completed_at IS NULL` clause is
-- load-bearing: without it, `continueWith` cannot write atomically — see
-- [continueWith write order](#why-the-tail-partial-requires-completed_at-is-null).
CREATE UNIQUE INDEX job_chain_tail_idx ON job (chain_id)
  WHERE continued_to_job_id IS NULL AND completed_at IS NULL;

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
  WHERE blocked = true
    AND leased_until IS NULL
    AND completed_at IS NULL;

CREATE INDEX job_pending_listing_idx ON job (type_name, scheduled_at)
  WHERE blocked = false
    AND leased_until IS NULL
    AND completed_at IS NULL;
-- The structural predicate "not blocked, not running, not completed" — i.e. the
-- runnable subset of `pending`. The `scheduled_at <= now()` / `> now()` split is
-- a runtime filter applied on top of the index-ordered scan. This index also
-- serves `getNextJobAvailableInMs` (wake-up on min(scheduled_at)).

CREATE INDEX job_completed_listing_idx ON job (type_name, completed_at DESC)
  WHERE completed_at IS NOT NULL AND continued_to_job_id IS NULL;

CREATE INDEX job_continued_listing_idx ON job (type_name, completed_at DESC)
  WHERE completed_at IS NOT NULL AND continued_to_job_id IS NOT NULL;
-- Split on the structural discriminator: a completion is either terminal or
-- handoff, never both, so per-write only one partial is touched. Dashboard
-- filters for either shape get an exact partial instead of a row-inspection
-- scan over a mixed partition.

-- Chain listing (root jobs only, by chain type)
CREATE INDEX chain_listing_idx ON job (chain_type_name, created_at DESC)
  WHERE chain_id = id;
```

Properties:

- Every index is partial on the active subset, the completed subset, or a structurally meaningful slice. No index covers the full table.
- The `job_chain_tail_idx` UNIQUE encodes an actual invariant: **at most one row per chain has no successor.** A `chain_index`-only schema can't express this directly; `continued_to_job_id` makes it a DB-enforced constraint.
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

  continuedToJobId: string | null;
  blocked: boolean;

  status: JobStatus; // derived at read time; never stored
  createdAt: Date;
  scheduledAt: Date;
  completedAt: Date | null;
  completedBy: string | null;

  attempt: number;
  lastAttemptError: string | null;
  lastAttemptAt: Date | null;

  leasedBy: string | null;
  leasedUntil: Date | null;

  deduplicationKey: string | null;
  chainTraceContext: string | null;
  traceContext: string | null;
};
```

`chainIndex` is **not** on `StateJob` — it's a storage detail. The cursor for `listChainJobs` is opaque-id-based; the SQL resolves position internally via `chain_index`. `incompleteChainIds` is **not** on `StateJob` either — the blocked detail is resolved at the public `Job` layer (see open question above).

### Adapter methods

- `acquireJob({ typeNames, workerId, leaseDurationMs })` — writes `leased_by`, `leased_until`, `attempt++` atomically with row selection. With no stored `status` column, "running" is the presence of `leased_until`, so the lease must be set at acquire time.
- `completeJob({ jobId, workerId, output? })` — writes `completed_at`, `completed_by`, `output` (nullable; null when the parent's `continued_to_job_id` was set earlier by a `continueWith`-driven `createJobs`). Single unified method; the row's `continued_to_job_id` distinguishes terminal from handoff.
- `createJobs` per-job input is distinguished structurally (chain start vs continuation) — for a continuation, the adapter inherits `chain_id`, `chain_type_name`, derives `chain_index`, and sets the parent's `continued_to_job_id` in the same transaction.
- `rescheduleJob({ jobId, schedule, error })` — sets `scheduled_at`, records the error.
- `addJobsBlockers` sets `blocked = true` on dependents with ≥1 incomplete blocker; `unblockJobs` sets `blocked = false` when the last blocker resolves.

### `Job` discriminated union

See [Public type](#public-type) above. Three top-level states; `completed` split structurally into terminal and continued.

## Why this is the irreducible model

### Why `blocked` (the acquisition benchmark)

`blocked` is the one denormalization that can't be eliminated. Benchmarked on Postgres 18 at 90k blocked / 10k pending, acquiring without denormalization (`NOT EXISTS (SELECT 1 FROM job_blocker … WHERE incomplete)`):

| shape         | with `blocked` flag | `NOT EXISTS` (no denormalization) |
| ------------- | ------------------- | --------------------------------- |
| random        | 0.01 ms             | 254 ms                            |
| blocked-front | 0.01 ms             | 202 ms                            |
| pending-front | 0.01 ms             | 193 ms                            |

A ~15,000–25,000× regression — the planner walks the full pending index probing `job_blocker` per row. ~800k buffer hits per acquire vs 3. No partial-index trick saves this: both PG and SQLite require partial-index predicates to be deterministic on the indexed row, ruling out `WHERE NOT EXISTS (…)`.

### Why `blocked` but not `job_blocker.open`

"Is this blocker resolved?" is a bounded-cost lookup via `job_chain_position_idx` (range scan over a single chain, typically short). The chain-tail partial covers the open case in O(1) and the position index covers the completed-tail case in O(chain length). A per-blocker-row `open` boolean would only save aggregation in `unblockJobs`, which already operates on a bounded set (the dependents of the just-completed chain). The single denormalization on `job.blocked` is irreducible; the second one isn't.

### Why the tail partial requires `completed_at IS NULL`

A naive `WHERE continued_to_job_id IS NULL` predicate would deadlock the natural `continueWith` write. Walk through it:

1. State at tx start: J1 is the current tail (`continued_to_job_id IS NULL`, `completed_at IS NULL`). J1 occupies the partial-unique slot for `(chain_id = C)`.
2. The handler returns `continueWith({ ... })`. The adapter wants to INSERT J2 with `chain_id = C` and `continued_to_job_id IS NULL`, then UPDATE J1 to point at J2 and mark it completed.

With the naive predicate, step 2's INSERT immediately conflicts with J1 — both rows want the same partial-unique slot. Partial-unique indexes can't be `DEFERRABLE` in either Postgres or SQLite (deferrability is a constraint property; partial uniques are necessarily plain indexes), so there is no way to defer the conflict to end-of-statement. Single-statement CTE rewrites don't help either: data-modifying CTEs materialize their row mutations into the index as they run.

Adding `AND completed_at IS NULL` to the predicate fixes this by giving the writer a way to evict J1 from the partial before J2 enters:

1. UPDATE J1 SET `completed_at = $now` — J1 leaves the partial.
2. INSERT J2 with `continued_to_job_id = NULL` — J2 enters the partial, no conflict.
3. UPDATE J1 SET `continued_to_job_id = J2.id` — no partial impact (J1 already out).

All three statements live inside the `continueWith` transaction; partial readers between them are not a concern (the tx is the only writer holding the row's lease). The invariant DB-side weakens from "at most one tail per chain" to "at most one open tail per running chain"; the stronger app-level invariant ("exactly one tail per chain at all times") is maintained by the same single write site (`continueWith → createJobs`) and the `(chain_id, chain_index)` UNIQUE. Completed-chain tail lookups (rare; only `chain completed?` / `blocker chain resolved?`) fall back to `job_chain_position_idx`, costing one bounded range scan.

### Why `continued_to_job_id` stored (not derived via `chain_index + 1` lookup)

- **Disambiguates terminal vs handoff at the storage layer**, not via the `output IS NULL` sentinel.
- **Encodes the "at most one successor" invariant via partial UNIQUE index**, DB-enforced.
- **SQLite mutating-CTE problem**: SQLite doesn't support `UPDATE … RETURNING *` joined back to a SELECT. Deriving the field on every read means ~13 SELECT sites each gaining a follow-up query in the SQLite adapter.
- **Single write site** (`continueWith` → `createJobs`), so drift surface is small and bounded by one CTE.

### Why no stored `status` column

Every value is a function of structural columns; writes touching multiple representations are drift-prone; enum-domain migrations are heavy (PG `ALTER TYPE ADD VALUE`, SQLite CHECK rewrite via `writable_schema`); the public vocabulary can evolve without renegotiating storage. Read-time derivation via row mapper or SQL CASE is cheap on bounded partial-index partitions.

### Why `chain_index` stays in storage (hidden from API)

Provides: (a) cheap range-scan ordering for chain listing, (b) `UNIQUE (chain_id, chain_index)` for race prevention on `continueWith`. Replacing range scans with recursive CTEs over `continued_to_job_id` is order-of-magnitude slower on cold cache. Keep `chain_index` as an SQL-internal ordering primitive; the public API surfaces `continued_to_job_id` instead.

The "is this a chain root?" predicate uses `chain_id = id` (roots set `chain_id` to their own id; non-roots inherit the root's id), not `chain_index = 0`. Both are correct; `chain_id = id` is preferred because it keeps `chain_index` out of read-side index predicates — its only remaining roles are ordering and uniqueness.

## Migration from current state

Delta to apply against the live `dev` branch (PG + SQLite migrations, in order). Commit `199dcb5b` already lands the `continued_to_job_id` column + backfill and removes `chainIndex` from the public surface; the steps below are framed against the pre-`199dcb5b` `dev` state and fold that work in.

1. **Add `continued_to_job_id {{id_type}} NULL REFERENCES job(id)`.** Backfill from `chain_index`: for every non-tail row of every chain, set `continued_to_job_id` to the row with the same `chain_id` and `chain_index = self.chain_index + 1`. (Tails — including roots of single-job chains — stay `NULL`.) On PG: single `UPDATE … FROM` correlated by `(chain_id, chain_index+1)`. On SQLite: same shape via correlated subquery. (Landed by `199dcb5b`.)
2. **Add `blocked boolean NOT NULL DEFAULT false`.** Backfill: `true` where `status = 'blocked'`, `false` otherwise.
3. **Drop the stored `status` column and (on PG) the `job_status` enum type.** Replace every read site with the derivation rule in [Derivation rule](#derivation-rule); every writer that previously maintained `status` is removed in the same change. The acquisition lease must be set in the same transaction that selects the row (since "running" is now `leased_until IS NOT NULL`).
4. **Create `job_chain_tail_idx UNIQUE` partial** on `(chain_id) WHERE continued_to_job_id IS NULL AND completed_at IS NULL`. The backfill from step 1 leaves at most one open tail per chain (completed chains end with a row whose `completed_at IS NOT NULL`, which is outside the partial), so the unique constraint is satisfied at creation time. The `completed_at IS NULL` clause is required for the `continueWith` write to be conflict-free — see [Why the tail partial requires completed_at IS NULL](#why-the-tail-partial-requires-completed_at-is-null).
5. **Rebuild status-dependent indexes against structural predicates**, replacing the `WHERE status = '…'` partials with the predicates from [Indexes](#indexes):
   - `job_acquisition_idx` → `job_ready_idx` (`WHERE blocked = false AND leased_until IS NULL AND completed_at IS NULL`).
   - `job_expired_lease_idx` → `job_running_idx` (`WHERE leased_until IS NOT NULL AND completed_at IS NULL`).
   - `job_listing_status_idx` is dropped; replaced by the per-status listing partials (`job_blocked_listing_idx`, `job_pending_listing_idx`, `job_completed_listing_idx`, `job_continued_listing_idx`) that match the derivation.
   - `job_listing_type_name_idx` keeps its shape but is renamed `job_listing_idx` (kept on the full table — the per-status partials handle filtered queries).
6. **Adjust the dedup partial** (`job_deduplication_idx`) to add the `completed_at IS NULL` predicate (open-scope) and swap the existing `chain_index = 0` clause for `chain_id = id`. Both clauses are equivalent on existing data (roots sit at `chain_id = id, chain_index = 0`, non-roots at `chain_id = root.id, chain_index > 0`); preferring `chain_id = id` keeps `chain_index` out of read-side index predicates.

No data loss: every value the old `status` column carried is reconstructible from the structural columns after steps 1–2.

`chain_index` stays on the row indefinitely. It is already SQL-internal (not on `StateJob`); removing the column entirely would force chain-listing queries onto recursive CTEs over `continued_to_job_id` (slow on cold cache) and would lose the dedup-root predicate. The column is the cheapest way to express "ordered position in chain" — we keep it.
