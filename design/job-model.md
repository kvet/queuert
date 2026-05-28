# Job + job_blocker model

> **Baseline for**: [state-snapshot-metrics.md](state-snapshot-metrics.md), [job-priority.md](job-priority.md), [scheduled-at-floor.md](scheduled-at-floor.md).

## Problem

Three coupled smells in prior models, fixable together:

1. **`status` is a denormalized cache.** Every value is decidable from columns the schema already needs for other reasons (`completed_at`, `leased_until`, `has_open_blockers`, `continued_to_job_id`). Keeping a stored `status` column forces every writer to maintain two representations in agreement, and every domain extension (continued-vs-terminal, ready-vs-scheduled) forces an enum-domain migration.
2. **`output: null` overloaded as a handoff sentinel.** A job that handed off via `continueWith` is `status: 'completed'` with `output: null`. Codecs/validators can't distinguish "terminated with null output" from "handed off, output meaningless." The discriminator wants to be a stored FK column, not a polymorphic null.
3. **`chain_index` leaks through the public API.** It exists for SQL ordering and race prevention — none of which is a user concern. The user-facing relationship is "this job continues to that job," not "this job is at position N."

The fixes are coupled: the FK that disambiguates terminal vs handoff is the same FK that lets us drop `chain_index` from the public surface; the status derivation that drops the column also lets us split `'completed'` into two type-level variants without an enum migration.

## Schema

### `job` columns

```
id                              -- PK
type_name                       -- string
chain_id                        -- FK to job(id); root job has chain_id = id
chain_index                     -- int, monotonic position in chain (0 = root); SQL-internal
continued_to_job_id             -- FK NULL; set when this job handed off to a successor
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
last_user_reschedule_attempt    -- int NULL; value of `attempt` at last user-initiated reschedule
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
          continuedToJobId: TJobId;
        }
      : never)
  | ([TOutput] extends [never]
      ? never
      : { status: "completed"; completedAt: Date; completedBy: string | null; output: TOutput })
);
```

Distinctions resolved vs. the prior model:

- `'pending'` (which collapsed "ready now" and "scheduled for later") splits into `'ready'` and `'scheduled'`.
- `'completed'` (which collapsed "chain terminus" and "handoff") splits into `'completed'` (terminal, carries `output`) and `'continued'` (handoff, carries `continuedToJobId`).
- `'blocked'` carries the open blocker chain ids inline — the type-level surface tells the user _what_ is blocking, not just _that_ something is.

### Derivation rule

Computed at read time in each adapter's row mapper:

```ts
function deriveStatus(row, now): JobStatus {
  if (row.completed_at !== null && row.continued_to_job_id !== null) return "continued";
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

### Chain status

Derived from the chain's tail (`continued_to_job_id IS NULL` for `chain_id = X`):

```ts
type ChainStatus = "open" | "closed";
```

A chain is `closed` iff its tail row has `completed_at IS NOT NULL`. Naming: `closed` is the antonym of `open` and abstracts over the terminal-completion path (today) plus any future terminal-non-success (cancellation, terminal failure) — those would all be substates of `closed`. The dedup `scope` becomes `'open' | 'any'` for consistency.

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

-- Chain frontier (the tail, whether closed or open)
SELECT … FROM job
WHERE chain_id = $1 AND continued_to_job_id IS NULL;
-- At most one row (UNIQUE partial index).

-- Chain closed?
SELECT 1 FROM job
WHERE chain_id = $1
  AND continued_to_job_id IS NULL
  AND completed_at IS NOT NULL;

-- Blocker chain resolved?
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
  WHERE has_open_blockers = false
    AND leased_until IS NULL
    AND completed_at IS NULL;

-- Lease reap; also serves "running" filter
CREATE INDEX job_running_idx ON job (leased_until)
  WHERE leased_until IS NOT NULL AND completed_at IS NULL;

-- Chain frontier (one row per chain). UNIQUE encodes "at most one tail per chain."
CREATE UNIQUE INDEX job_chain_tail_idx ON job (chain_id)
  WHERE continued_to_job_id IS NULL;

-- Chain ordered traversal + race prevention for continueWith
CREATE UNIQUE INDEX job_chain_position_idx ON job (chain_id, chain_index);

-- Dedup (open-scope, common case)
CREATE INDEX job_dedup_open_idx ON job (deduplication_key, created_at DESC)
  WHERE deduplication_key IS NOT NULL
    AND chain_index = 0
    AND completed_at IS NULL;

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
-- Serves both 'ready' and 'scheduled' filters; the now() split is a runtime
-- filter on the index ordering.

CREATE INDEX job_done_listing_idx ON job (type_name, completed_at DESC)
  WHERE completed_at IS NOT NULL;
-- Serves both 'completed' and 'continued'; the variant discriminator
-- (continued_to_job_id NULL/NOT NULL) is filtered at row inspection.

-- Chain listing (root jobs only, by chain type)
CREATE INDEX chain_listing_idx ON job (chain_type_name, created_at DESC)
  WHERE chain_index = 0;
```

Properties:

- Every index is partial on the active subset, the completed subset, or a structurally meaningful slice. No index covers the full table.
- The `job_chain_tail_idx` UNIQUE encodes an actual invariant: **at most one row per chain has no successor.** Today's `chain_index`-based schema can't express this directly; `continued_to_job_id` makes it a DB-enforced constraint.
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
  hasOpenBlockers: boolean;

  status: JobStatus; // derived at read time; never stored
  createdAt: Date;
  scheduledAt: Date;
  completedAt: Date | null;
  completedBy: string | null;

  attempt: number;
  lastUserRescheduleAttempt: number | null;
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

- `acquireJob({ typeNames, workerId, leaseDurationMs })` — writes `leased_by`, `leased_until`, `attempt++` atomically with row selection. With no stored `status` column, "running" is the presence of `leased_until`, so the lease must be set at acquire time.
- `completeJob({ jobId, workerId, output? })` — writes `completed_at`, `completed_by`, `output` (nullable; null when the parent's `continued_to_job_id` was set earlier by a `continueWith`-driven `createJobs`). Single unified method; the row's `continued_to_job_id` distinguishes terminal from handoff.
- `createJobs` per-job input is `{ kind: "chainStart" | "continueWith", ... }` — for `continueWith`, the adapter inherits `chain_id`, `chain_type_name`, derives `chain_index`, and sets the parent's `continued_to_job_id` in the same transaction.
- `rescheduleJob({ jobId, schedule, error, userInitiated })` — when `userInitiated = true`, sets `last_user_reschedule_attempt = attempt`. Otherwise leaves it.
- `addJobsBlockers` sets `has_open_blockers = true` on dependents with ≥1 incomplete blocker; `unblockJobs` sets `has_open_blockers = false` when the last blocker resolves.

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

The chain-tail partial index makes "is this blocker resolved?" O(1) via the unique partial on `(chain_id) WHERE continued_to_job_id IS NULL`. A per-blocker-row `open` boolean would only save aggregation in `unblockJobs`, which already operates on a bounded set (the dependents of the just-completed chain). The single denormalization on `job.has_open_blockers` is irreducible; the second one isn't.

### Why `continued_to_job_id` stored (not derived via `chain_index + 1` lookup)

- **Disambiguates terminal vs handoff at the storage layer**, not via the `output IS NULL` sentinel.
- **Encodes the "at most one successor" invariant via partial UNIQUE index**, DB-enforced.
- **SQLite mutating-CTE problem**: SQLite doesn't support `UPDATE … RETURNING *` joined back to a SELECT. Deriving the field on every read means ~13 SELECT sites each gaining a follow-up query in the SQLite adapter.
- **Single write site** (`continueWith` → `createJobs`), so drift surface is small and bounded by one CTE.

### Why no stored `status` column

Every value is a function of structural columns; writes touching multiple representations are drift-prone; enum-domain migrations are heavy (PG `ALTER TYPE ADD VALUE`, SQLite CHECK rewrite via `writable_schema`); the public vocabulary can evolve without renegotiating storage. Read-time derivation via row mapper or SQL CASE is cheap on bounded partial-index partitions.

### Why `chain_index` stays in storage (hidden from API)

Provides: (a) cheap range-scan ordering for chain listing, (b) `UNIQUE (chain_id, chain_index)` for race prevention on `continueWith`, (c) dedup `chain_index = 0` predicate for "is this a chain root." Replacing range scans with recursive CTEs over `continued_to_job_id` is order-of-magnitude slower on cold cache. Keep `chain_index` as an SQL-internal ordering primitive; the public API surfaces `continued_to_job_id` instead.

## Migration from current state

The current `next` branch already has `has_blockers` and `continued_to_job_id` from the prior refactors. This design proposes name refinements and one additive column:

1. **Rename** `has_blockers` → `has_open_blockers`. Pure rename: column-level on PG (`ALTER TABLE … RENAME COLUMN`), SQLite via the `ALTER TABLE` rename.
2. **Add** `last_user_reschedule_attempt int NULL`. Backfill is `NULL` (no historical data to recover).
3. **Add** `job_chain_tail_idx UNIQUE` partial on `(chain_id) WHERE continued_to_job_id IS NULL`. This is a new invariant the DB will enforce; backfill should already satisfy it given how `createJobs` writes the FK.
4. **Rename indexes** to match the new vocabulary (cosmetic).
5. **Add `chain_index = 0` to the dedup partial** (it's already there) and the `completed_at IS NULL` predicate (open-scope).

The remaining structural columns (`leased_by`, `leased_until`, `completed_at`, `completed_by`, `output`, `continued_to_job_id`, etc.) are already present; only names and one new column change.

## Compatibility with other designs

### `state-snapshot-metrics.md`

Depends on:

- **Derived `status` as a labelable thing for gauges.** This design provides it; metrics queries compute status via CASE over the active partition or filter via the per-status listing partials.
- **`last_user_reschedule_attempt` column** for stuck-job gauges. Added by this design (it was originally proposed there as `attempts_since_reschedule`; this design replaces the counter with the structural monotonic marker — same information, derived `attempt - COALESCE(last_user_reschedule_attempt, 0)`).
- **Active-partition partial indexes** so metrics scans don't touch completed history. Provided by `job_pending_listing_idx`, `job_blocked_listing_idx`, `job_running_idx`, `job_chain_tail_idx` — together they cover every "incomplete" slice the metrics layer needs.

`state-snapshot-metrics.md` should remove its schema-change section (the column add is now here) and reference this doc for the derivation rule and underlying indexes; metrics-specific indexes (if any beyond what's here) remain in that doc.

### `job-priority.md`

Adds `priority INTEGER NOT NULL DEFAULT 0` and changes the acquisition ORDER BY to `(priority - attempt) DESC, scheduled_at ASC` via an expression index.

Additive verification:

- **Acquisition partial predicate is unchanged.** The expression index built by job-priority retains our `WHERE has_open_blockers = false AND leased_until IS NULL AND completed_at IS NULL` partial — only the index columns change to include the demotion expression.
- **`getNextJobAvailableInMs` stays priority-blind** (per job-priority.md's own design), and our `job_pending_listing_idx` ordered by `scheduled_at` serves it directly.
- **`priority` column adds to the row**; `StateJob.priority` adds to the type. Doesn't intersect with any structural column this design defines.
- **In-process adapter SortedSet** comparator gains the demotion math. This design's in-process model is already a per-status set; job-priority refines the comparator on the same set.
- **No conflict with `continued_to_job_id` / `has_open_blockers` / status derivation** — priority is orthogonal to status and to the chain link.

job-priority lands as a strict extension: one column, one index swap, one comparator update.

## What this doesn't address

- **1M-blocker scaling** (per the old `add-job-blocker.md` proposal). Counter-style denormalization on `job` is ruled out by MVCC dead-tuple cost; an alternative denormalization on `job_blocker` (e.g. row-deletion-on-resolution) is orthogonal to this design and unsettled.
- **Runtime-added blockers** (`addJobBlocker` on a `running` row). The derivation rule's "running wins over blocked" precedence assumes blockers can't appear during execution. If runtime addition lands, the derivation needs a separate `runtime_blockers_count` field or similar; out of scope here.
- **Chain-level cancellation / terminal-failure**. `ChainStatus = 'open' | 'closed'` is shaped to accommodate these as `closed` substates later, but the substates themselves aren't designed here.
