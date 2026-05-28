# Job + job_blocker model

> **Baseline for**: [state-snapshot-metrics.md](state-snapshot-metrics.md), [job-priority.md](job-priority.md), [scheduled-at-floor.md](scheduled-at-floor.md).

## Problem

Three coupled smells in prior models, fixable together:

1. **`status` is a denormalized cache.** Every value is decidable from columns the schema already needs for other reasons (`closed_at`, `leased_until`, `has_open_blockers`, `continued_to_job_id`). Keeping a stored `status` column forces every writer to maintain two representations in agreement, and every domain extension (continued-vs-terminal, ready-vs-scheduled) forces an enum-domain migration.
2. **`output: null` overloaded as a handoff sentinel.** A job that handed off via `continueWith` was `status: 'completed'` with `output: null`. Codecs/validators can't distinguish "terminated with null output" from "handed off, output meaningless." The discriminator wants to be a stored FK column, not a polymorphic null.
3. **`chain_index` leaks through the public API.** It exists for SQL ordering and race prevention — none of which is a user concern. The user-facing relationship is "this job continued to that job," not "this job is at position N."

The fixes are coupled: the FK that disambiguates terminal vs handoff is the same FK that lets us drop `chain_index` from the public surface; the status derivation that drops the column also lets us split the terminal state into two type-level variants without an enum migration.

A fourth, naming-level smell drove the final shape: a job's status mixed two levels — a coarse lifecycle (is it done?) and fine-grained execution detail (why isn't it running yet / how did it finish). Flattening them into one six-value enum is what made `scheduled` look like a peer of `running`. Splitting status into a coarse `open | closed` axis plus a `detail` sub-discriminator — symmetric with the chain's own `open | closed` — resolves it.

## Schema

### `job` columns

```
id                              -- PK
type_name                       -- string
chain_id                        -- FK to job(id); root job has chain_id = id
chain_index                     -- int, monotonic position in chain (0 = root); SQL-internal
continued_to_job_id             -- FK NULL; set when this job continued to a successor
input                           -- jsonb
output                          -- jsonb NULL; set on terminal completion only
created_at                      -- timestamp NOT NULL; immutable origin
open_at                         -- timestamp NOT NULL; start of current open episode (= created_at at insert)
scheduled_at                    -- timestamp; when this job is eligible for processing
has_open_blockers               -- boolean NOT NULL DEFAULT false; denormalized blocker readiness
leased_by                       -- string NULL; worker id of current lease
leased_until                    -- timestamp NULL; lease deadline (also gates "running")
closed_at                       -- timestamp NULL; set on any terminal event (output or handoff); gates open/closed
closed_by                       -- string NULL; worker id of closer
attempt                         -- int NOT NULL DEFAULT 0
last_attempt_error              -- jsonb NULL
last_attempt_at                 -- timestamp NULL
deduplication_key               -- string NULL
trace_context                   -- string NULL
chain_trace_context             -- string NULL
```

No `status` column. No `job_status` enum type (on PG). `chain_index` stays in storage but is hidden from the public API surface — it exists purely to make the SQL fast and safe (range scans for chain listing, `UNIQUE (chain_id, chain_index)` for race prevention and the "at most one tail" invariant).

**`created_at` vs `open_at`.** `created_at` is the immutable birth fact (total lifetime); `open_at` is the start of the *current* open episode. They are equal at insert and diverge only on a future reset/reopen, where the row re-enters `open` (`open_at = now`, `closed_at = NULL`). Until reset ships, `open_at` is written once and never moves — see [Why open_at when reset doesn't exist yet](#why-open_at-when-reset-doesnt-exist-yet).

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

The model is two levels:

- **`status` (coarse)** — `open | closed`. The general lifecycle axis, shared with `ChainStatus`. Low-cardinality; the right label for OTel and at-a-glance views. Derived from `closed_at`.
- **`detail` (fine)** — the execution sub-state *within* a status. `open` decomposes into `ready | scheduled | blocked | running`; `closed` decomposes into `completed | continued`. Mutually exclusive within a status.

`running` is deliberately a `detail` of `open`, not a coarse status. A lease is a property of a *job row*; at the chain level "running" is a fact about the tail job, so a chain can't carry it coarsely. Keeping `running` under `open` makes the coarse axis identical for jobs and chains — the asymmetry disappears.

### Public type

```ts
type JobStatus = "open" | "closed";
type JobDetail = "ready" | "scheduled" | "blocked" | "running" | "completed" | "continued";

type Job<TJobId, TJobTypeName, TChainTypeName, TInput, TOutput, TCanContinue extends boolean> = {
  id: TJobId;
  chainId: TJobId;
  typeName: TJobTypeName;
  chainTypeName: TChainTypeName;
  input: TInput;
  createdAt: Date; // immutable origin — total lifetime
  openAt: Date; // start of current open episode — "open since"
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
} & (
  | ({ status: "open"; scheduledAt: Date } & (
      | { detail: "ready" }
      | { detail: "scheduled" }
      | { detail: "blocked"; blockedByChainIds: TJobId[] }
      | { detail: "running"; leasedBy: string; leasedUntil: Date }
    ))
  | ({ status: "closed"; closedAt: Date; closedBy: string | null } & (
      | ([TOutput] extends [never] ? never : { detail: "completed"; output: TOutput })
      | (TCanContinue extends true ? { detail: "continued"; continuedToJobId: TJobId } : never)
    ))
);
```

Distinctions and placements:

- The coarse `status` is `open | closed`, the same two values as `ChainStatus`. `open` covers `ready | scheduled | blocked | running`; `closed` covers `completed | continued`.
- The old `'pending'` (which collapsed "ready now" and "scheduled for later") is `open` with `detail: 'ready' | 'scheduled'`.
- The old `'completed'` (which collapsed "chain terminus" and "handoff") is `closed` with `detail: 'completed'` (terminal, carries `output`) vs `detail: 'continued'` (handoff, carries `continuedToJobId`). Both are completions of the job's work; the detail names what the job did to the *chain* (completed it vs continued it), which is why neither is called "succeeded."
- `blocked` carries the blocker chain ids inline (`blockedByChainIds`) — the type-level surface tells the user _what_ is blocking, not just _that_ something is.
- `scheduledAt` lives on the `open` variant only: it is the eligibility gate, meaningful while open and historical noise once closed.
- `openAt` and `createdAt` are in the base (meaningful in both states): on a closed job, `closedAt − openAt` is the current-episode duration and `closedAt − createdAt` the total lifetime.

### Derivation rule

Computed at read time from the structural columns — `status` and `detail` both come from the row:

```ts
function deriveJob(row, now): { status: JobStatus; detail: JobDetail } {
  if (row.closed_at !== null) {
    const detail = row.continued_to_job_id !== null ? "continued" : "completed";
    return { status: "closed", detail };
  }
  const detail =
    row.leased_until !== null ? "running" :
    row.has_open_blockers     ? "blocked" :
    row.scheduled_at > now    ? "scheduled" :
                                "ready";
  return { status: "open", detail };
}
```

Order encodes the legal precedence: completion gates first (`closed_at` set → `closed`, with `continued_to_job_id` selecting the flavor); then within `open`, an active lease (`running`) wins over a runtime-added blocker (a job in flight isn't gated by anything); an absolute gate (blockers) beats a time gate (`scheduled_at`); `scheduled` vs `ready` is the `now()` comparison.

`leased_until` (not `leased_by`) is the running gate. `leased_by` is attribution.

`closed_at` (not `output IS NOT NULL`) is the closed gate. A handler returning `complete(null)` legitimately writes `output = NULL`; a `continueWith` writes `continued_to_job_id` and `output = NULL`. Only `closed_at` reliably means "done."

### Chain status

Derived from the chain's tail (`continued_to_job_id IS NULL` for `chain_id = X`):

```ts
type ChainStatus = "open" | "closed";
```

A chain is `closed` iff its tail row has `closed_at IS NOT NULL`. The chain's timestamps mirror the rows that bound it: `chain.openAt = root.open_at`, `chain.closedAt = tail.closed_at`. Naming: `closed` is the antonym of `open` and abstracts over the terminal-completion path (today) plus any future terminal-non-success (cancellation, terminal failure) — those would all be substates of `closed`. The dedup `scope` is `'open' | 'any'` for consistency.

## SQL hot paths

```sql
-- Acquisition (hottest)
SELECT … FROM job
WHERE type_name = ANY($types)
  AND has_open_blockers = false
  AND leased_until IS NULL
  AND closed_at IS NULL
  AND scheduled_at <= now()
ORDER BY scheduled_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;

-- Reap expired leases
SELECT … FROM job
WHERE leased_until IS NOT NULL
  AND leased_until <= now()
  AND closed_at IS NULL
ORDER BY leased_until ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;

-- Chain frontier (the tail, whether closed or open)
SELECT … FROM job
WHERE chain_id = $1 AND continued_to_job_id IS NULL;
-- At most one row (enforced via UNIQUE (chain_id, chain_index); see Indexes).

-- Chain closed?
SELECT 1 FROM job
WHERE chain_id = $1
  AND continued_to_job_id IS NULL
  AND closed_at IS NOT NULL;

-- Blocker chain resolved?
SELECT 1 FROM job
WHERE chain_id = $blocker_chain_id
  AND continued_to_job_id IS NULL
  AND closed_at IS NOT NULL;

-- Listing by computed status/detail (dashboard)
-- Filter via the partial-index family in `Indexes`: status = open/closed maps to
-- (closed_at IS NULL) / (closed_at IS NOT NULL); detail maps to the structural
-- predicates in deriveJob.

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
    AND closed_at IS NULL;

-- Lease reap; also serves "running" filter
CREATE INDEX job_running_idx ON job (leased_until)
  WHERE leased_until IS NOT NULL AND closed_at IS NULL;

-- Chain frontier (one row per chain). NON-unique — see note below.
CREATE INDEX job_chain_tail_idx ON job (chain_id)
  WHERE continued_to_job_id IS NULL;

-- Chain ordered traversal + race prevention + "at most one tail" invariant
CREATE UNIQUE INDEX job_chain_position_idx ON job (chain_id, chain_index);

-- Dedup (open-scope, common case)
CREATE INDEX job_dedup_open_idx ON job (deduplication_key, created_at DESC)
  WHERE deduplication_key IS NOT NULL
    AND chain_index = 0
    AND closed_at IS NULL;

-- Reverse-lookup: jobs blocked by a given chain
CREATE INDEX job_blocker_chain_idx ON job_blocker (blocked_by_chain_id);

-- Dashboard / state-snapshot listing partials
CREATE INDEX job_listing_idx ON job (type_name, created_at DESC);

CREATE INDEX job_blocked_listing_idx ON job (type_name, created_at DESC)
  WHERE has_open_blockers = true
    AND leased_until IS NULL
    AND closed_at IS NULL;

CREATE INDEX job_open_listing_idx ON job (type_name, scheduled_at)
  WHERE has_open_blockers = false
    AND leased_until IS NULL
    AND closed_at IS NULL;
-- Serves both 'ready' and 'scheduled' details; the now() split is a runtime
-- filter on the index ordering.

CREATE INDEX job_closed_listing_idx ON job (type_name, closed_at DESC)
  WHERE closed_at IS NOT NULL;
-- Serves both 'completed' and 'continued'; the detail discriminator
-- (continued_to_job_id NULL/NOT NULL) is filtered at row inspection.

-- Chain listing (root jobs only, by chain type)
CREATE INDEX chain_listing_idx ON job (chain_type_name, created_at DESC)
  WHERE chain_index = 0;
```

Properties:

- Every index is partial on the active subset, the closed subset, or a structurally meaningful slice. No index covers the full table.
- **`job_chain_tail_idx` is NOT unique.** A `UNIQUE` partial on `(chain_id) WHERE continued_to_job_id IS NULL` looks attractive ("at most one tail per chain") but breaks `continueWith`: mid-transaction there are transiently two `continued_to_job_id IS NULL` rows (the new tail is inserted before the parent's link is set), and neither PG nor SQLite can defer a *partial* unique index to commit time. The "at most one tail" invariant is instead enforced by the existing `UNIQUE (chain_id, chain_index)` — the new tail and the parent never share a `chain_index`.
- Status/detail dashboard filters hit per-slice partials; the acquisition / running / closed / blocked / open listing partials together cover every status and detail without a stored `status` column.

## Public API contract

### State adapter (`StateJob`)

`StateJob` is the raw structural snapshot the adapter returns. It carries no derived `status`/`detail` — those are computed in core (`deriveJob`) from these columns. It is a *read snapshot, not a cacheable entity*: `scheduledInFuture` is evaluated against the adapter's clock at read time.

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

  createdAt: Date;
  openAt: Date;
  scheduledAt: Date;
  scheduledInFuture: boolean; // scheduled_at > now(), snapshot against the adapter clock
  closedAt: Date | null;
  closedBy: string | null;

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

`chainIndex` is **not** on `StateJob` — it's a storage detail. The cursor for `listChainJobs` is opaque-id-based; the SQL resolves position internally via `chain_index`.

### Adapter methods

- `acquireJob({ typeNames, workerId, leaseDurationMs })` — writes `leased_by`, `leased_until`, `attempt++` atomically with row selection. With no stored `status` column, "running" is the presence of `leased_until`, so the lease must be set at acquire time.
- `completeJob({ jobId, workerId, output? })` — writes `closed_at`, `closed_by`, `output` (nullable; null when the row's `continued_to_job_id` was set earlier by a `continueWith`-driven `createJobs`). Single unified method; `continued_to_job_id` distinguishes terminal (`completed`) from handoff (`continued`).
- `createJobs` per-job input is structurally narrowed — chain start (`chainTypeName`) vs continuation (`continueFromJobId`). For a continuation, the adapter inherits `chain_id`, `chain_type_name`, derives `chain_index`, and sets the parent's `continued_to_job_id` in the same transaction. (`continueFromJobId` on the input and `continued_to_job_id` on the parent form a from/to pair.)
- `rescheduleJob({ jobId, schedule, error })` — sets `scheduled_at`, `last_attempt_error`, `last_attempt_at`.
- `addJobsBlockers` sets `has_open_blockers = true` on dependents with ≥1 incomplete blocker; `unblockJobs` sets `has_open_blockers = false` when the last blocker resolves.

### `Job` discriminated union

See [Public type](#public-type) above. Coarse `open | closed`, each with a `detail` sub-discriminator and just-right data.

## Why this is the irreducible model

### Why `has_open_blockers` (the acquisition benchmark)

`has_open_blockers` is the one denormalization that can't be eliminated. Benchmarked on Postgres 18 at 90k blocked / 10k open, acquiring without denormalization (`NOT EXISTS (SELECT 1 FROM job_blocker … WHERE incomplete)`):

| shape         | with `has_open_blockers` | `NOT EXISTS` (no denormalization) |
| ------------- | ------------------------ | --------------------------------- |
| random        | 0.01 ms                  | 254 ms                            |
| blocked-front | 0.01 ms                  | 202 ms                            |
| pending-front | 0.01 ms                  | 193 ms                            |

A ~15,000–25,000× regression — the planner walks the full open index probing `job_blocker` per row. ~800k buffer hits per acquire vs 3. No partial-index trick saves this: both PG and SQLite require partial-index predicates to be deterministic on the indexed row, ruling out `WHERE NOT EXISTS (…)`.

### Why `has_open_blockers` but not `job_blocker.open`

The chain-tail partial index makes "is this blocker resolved?" cheap via `(chain_id) WHERE continued_to_job_id IS NULL`. A per-blocker-row `open` boolean would only save aggregation in `unblockJobs`, which already operates on a bounded set (the dependents of the just-completed chain). The single denormalization on `job.has_open_blockers` is irreducible; the second one isn't.

### Why `continued_to_job_id` stored (not derived via `chain_index + 1` lookup)

- **Disambiguates terminal vs handoff at the storage layer**, not via the `output IS NULL` sentinel.
- **SQLite mutating-CTE problem**: SQLite doesn't support `UPDATE … RETURNING *` joined back to a SELECT. Deriving the field on every read means ~13 SELECT sites each gaining a follow-up query in the SQLite adapter.
- **Single write site** (`continueWith` → `createJobs`), so drift surface is small and bounded by one CTE.
- The "at most one successor / one tail" invariant is enforced via `UNIQUE (chain_id, chain_index)`, not a partial unique index on the FK (a partial unique on `continued_to_job_id IS NULL` can't be deferred past the transient dual-tail state inside `continueWith` — see [Indexes](#indexes)).

### Why no stored `status` column

Every value is a function of structural columns; writes touching multiple representations are drift-prone; enum-domain migrations are heavy (PG `ALTER TYPE ADD VALUE`, SQLite CHECK rewrite via `writable_schema`); the public vocabulary can evolve without renegotiating storage. Read-time derivation via row mapper or SQL CASE is cheap on bounded partial-index partitions. The two-level `status`/`detail` split is what makes this cheap to extend: a new detail is a new derivation branch, not a migration.

### Why `chain_index` stays in storage (hidden from API)

Provides: (a) cheap range-scan ordering for chain listing, (b) `UNIQUE (chain_id, chain_index)` for race prevention on `continueWith` and the "at most one tail" invariant, (c) dedup `chain_index = 0` predicate for "is this a chain root." Replacing range scans with recursive CTEs over `continued_to_job_id` is order-of-magnitude slower on cold cache. Keep `chain_index` as an SQL-internal ordering primitive; the public API surfaces `continued_to_job_id` instead.

### Why `open_at` when reset doesn't exist yet

`open_at` is the start of the current open episode; it diverges from `created_at` only on a reset/reopen, which is a roadmap item, not built. Adding the column now is a deliberate reservation: this branch's migration is already open, so carrying `open_at` (backfilled `= created_at`) now makes reset a pure additive feature later instead of a second migration. Until then `open_at` is written once and never moves, and every metric that anchors on it behaves identically to anchoring on `created_at`. The only cost paid today is one dormant `NOT NULL` column; the payoff is that reset never needs to renegotiate the schema. (Note: `open_at` moves only on a *status* transition back to `open` — never on a `detail` change like acquire/retry/unblock, which would turn it into a meaningless last-transition timestamp.)

## Migration from current state

The current `next` branch already has `has_open_blockers`, `completed_at`/`completed_by`, and the `continued_to_job_id` FK from prior refactors. This design proposes name refinements and one additive column. All of it is unreleased, so the renames are edits-in-place to the branch's own migration — users never observe an intermediate vocabulary.

1. **Rename** `completed_at` → `closed_at`, `completed_by` → `closed_by`. Pure rename: column-level on PG (`ALTER TABLE … RENAME COLUMN`), SQLite via the `ALTER TABLE` rename.
2. **Add** `open_at timestamp NOT NULL`. Backfill `open_at = created_at` for existing rows.
3. **`job_chain_tail_idx` stays NON-unique** (the "at most one tail" invariant rides on `UNIQUE (chain_id, chain_index)`; a partial-unique on the tail breaks `continueWith` — see [Indexes](#indexes)).
4. **Rename indexes** to match the new vocabulary (`job_pending_listing_idx` → `job_open_listing_idx`, `job_done_listing_idx` → `job_closed_listing_idx`, etc.).
5. **Keep** the dedup partial's `chain_index = 0` and `closed_at IS NULL` (open-scope) predicates.

The `has_open_blockers` column and `continued_to_job_id` FK already carry their final names throughout the branch (code, schema, and changeset), so neither needs a rename step.

The remaining structural columns (`leased_by`, `leased_until`, `output`, etc.) are already present; only names and one new column change.

## Compatibility with other designs

### `state-snapshot-metrics.md`

Depends on:

- **Derived `status`/`detail` as labelable things for gauges.** This design provides them; metrics queries compute them via CASE over the active partition or filter via the per-slice listing partials. Low-cardinality OTel attributes: `status` (`open|closed`), `detail`.
- **Age metrics anchor on `open_at`, not `created_at`.** "Oldest open job age" = `now − min(open_at)` over open jobs; queue-wait / time-to-first-attempt = `first_attempt_at − open_at`. A reopened job that's fresh must not read as ancient by its original birth. `created_at` is a correlation/audit attribute only. (Until reset ships, the two anchors coincide.)
- **Active-partition partial indexes** so metrics scans don't touch closed history. Provided by `job_open_listing_idx`, `job_blocked_listing_idx`, `job_running_idx`, `job_chain_tail_idx`.

A **`stuck`** signal (the "this keeps failing, a human should look" attention flag) is **not** part of this design — it's owned by `state-snapshot-metrics.md`, which defines its own mechanism (e.g. an attempt-delta column and threshold) without touching the status model here. `state-snapshot-metrics.md` should reference this doc for the derivation rule and underlying indexes; any stuck-specific column/index lives in that doc.

### `job-priority.md`

Adds `priority INTEGER NOT NULL DEFAULT 0` and changes the acquisition ORDER BY to `(priority - attempt) DESC, scheduled_at ASC` via an expression index.

Additive verification:

- **Acquisition partial predicate is unchanged.** The expression index built by job-priority retains our `WHERE has_open_blockers = false AND leased_until IS NULL AND closed_at IS NULL` partial — only the index columns change to include the demotion expression.
- **`getNextJobAvailableInMs` stays priority-blind** (per job-priority.md's own design), and our `job_open_listing_idx` ordered by `scheduled_at` serves it directly.
- **`priority` column adds to the row**; `StateJob.priority` adds to the type. Doesn't intersect with any structural column this design defines.
- **In-process adapter SortedSet** comparator gains the demotion math. This design's in-process model is already a per-state set; job-priority refines the comparator on the same set.
- **No conflict with `continued_to_job_id` / `has_open_blockers` / status derivation** — priority is orthogonal to status and to the chain link.

job-priority lands as a strict extension: one column, one index swap, one comparator update.

## What this doesn't address

- **Reset / reopen.** `open_at` reserves the schema for it (a closed job re-entering `open`), but the operation itself — what it clears, how `attempt` resets, dashboard surface — isn't designed here.
- **`stuck` / attention signals.** Deliberately out of scope — owned by `state-snapshot-metrics.md` (see [Compatibility](#state-snapshot-metricsmd)).
- **1M-blocker scaling** (per the old `add-job-blocker.md` proposal). Counter-style denormalization on `job` is ruled out by MVCC dead-tuple cost; an alternative denormalization on `job_blocker` (e.g. row-deletion-on-resolution) is orthogonal to this design and unsettled.
- **Runtime-added blockers** (`addJobBlocker` on a `running` row). The derivation rule's "running wins over blocked" precedence assumes blockers can't appear during execution. If runtime addition lands, the derivation needs a separate `runtime_blockers_count` field or similar; out of scope here.
- **Chain-level cancellation / terminal-failure**. `ChainStatus = 'open' | 'closed'` is shaped to accommodate these as `closed` substates later, but the substates themselves aren't designed here.
