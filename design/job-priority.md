# Built-in job priority

## Problem

A queuert deployment runs heterogeneous workloads through a shared worker pool. In production today the user has two coexisting flavors of the same chain type: foreground chains (synchronous test runs awaiting completion, latency-sensitive) and background chains (scheduled batch processing, latency-tolerant). With FIFO acquisition (`ORDER BY scheduled_at ASC`), a background chain that lands a millisecond before a foreground chain blocks the foreground one — workers happily drain the background backlog while the foreground caller sits on `awaitChain`.

The escape hatches available today are unsatisfying:

- **Separate type names.** Works, but forces the user to fork the chain definition and the worker bindings even though the work is identical. Every test gets a one-off boolean threaded through the call site to pick which type name to enqueue.
- **Separate worker pools / `typeNames` filters.** Same fork pressure plus capacity planning for both pools — when foreground is idle, those workers can't help drain background.
- **Manual `scheduledAt` skew.** Setting background `scheduledAt = now() + 60s` is a footgun: it changes the meaning of "when this should run" instead of expressing "what order to run it in."

The data model already names everything we need to encode "run this one first" except the relative ordering signal itself. Adding a `priority` field expresses the constraint directly, lets workers stay shared, and keeps the two flavors on a single chain definition.

## Approach

Add an integer `priority` column to the job table with `DEFAULT 0`. Acquisition orders by **effective priority** — `priority` minus a log-scale penalty for failed attempts — falling back to `scheduled_at ASC` for ties:

```
ORDER BY (priority - attempt) DESC, scheduled_at ASC
```

Higher numbers run first; negative numbers run after default. No floor, no ceiling — convention is left to users (`10`/`0`/`-10` is fine; so is `1000`/`0`/`-1000`). The acquisition index is rebuilt as an **expression index** matching the ORDER BY exactly — see [Schema](#schema).

Three coupled API surfaces gain an optional `priority?: number`:

1. `startChain` / `startChains` — root job's priority.
2. `continueWith` (worker handler) — successor job's priority. **Defaults to the parent's priority** so chains run as a unit unless the user overrides.
3. The `addJobBlocker` chain start (when that ships) inherits from its own startChain entry — no special handling.

The library does not export named-priority constants. Users adopt their own convention (`-10`/`0`/`10` is fine; so is `1`/`0`).

`triggerJob` and `triggerJobs` do **not** accept priority — they reset `scheduled_at` to now without otherwise mutating the job. Changing priority via trigger would conflate two operations.

The two starvation modes get different answers:

- **Failed-job hogging** (a flaky high-priority job retries forever, monopolizing worker capacity): solved directly by the log-scale demotion. After 1 retry a `+10` job is at effective `+9`. After 7, at `+7`. After 1024, at 0. Stuck jobs naturally yield to fresh ones.
- **Continuous-arrival starvation** (sustained high-priority traffic blocks low-priority work indefinitely): documented v1 footgun, with the recommended mitigations: bound the high-priority arrival rate, or run low-priority work under a separate type name with a dedicated worker. Wall-clock aging — the textbook fix — is deferred to v2 with a clean upgrade path. See [Why log-scale demotion in v1, wall-clock aging in v2](#why-log-scale-demotion-in-v1-wall-clock-aging-in-v2).

## Why numeric, not named tiers

Considered `"high" | "normal" | "low"` literal union. Rejected:

- Numeric matches the SQL representation directly (`INTEGER NOT NULL DEFAULT 0`); named tiers would need a string enum or a tier-to-int mapping table on every read.
- Named tiers force a decision now about how many tiers exist. Numeric punts that to the user — they can pick `1`/`0` for two-tier, or `10`/`0`/`-10` for three-tier without the library's vocabulary getting in the way.
- Sort semantics are unambiguous in numeric form (`DESC` = "higher first"). With names, "is `high` greater than `normal`?" requires the user to check our docs.
- Future "negative priority" (run-after-everything-else) is free with numeric and awkward with named tiers ("how do I get below low?").

The tradeoff is self-documentation at the call site. Users who want named values are free to declare their own (`const Priority = { foreground: 10, background: 0 } as const`) — the library doesn't ship constants because doing so would re-introduce exactly the "what does the library mean by `high`?" debate this section just argued against.

## Why linear demotion in v1, wall-clock aging in v2

There are two different "fairness" problems people lump together as "aging":

1. **Failure-driven demotion.** A job that has retried N times has demonstrated it's not making progress — it should yield to fresh work at the same nominal priority. Triggered by `attempt`, a stored column.
2. **Wall-clock aging.** Long-waiting low-priority jobs eventually deserve a turn even without failing. Triggered by `now() - scheduled_at`, clock-dependent.

They have different cost structures and v1 ships the cheap one.

### Demotion-by-attempts: in v1

`priority - attempt` subtracts one effective-priority point per retry:

| attempts | demotion | semantics                                        |
| -------- | -------- | ------------------------------------------------ |
| 0        | 0        | fresh job, full priority                         |
| 1        | 1        | retried once — visibly struggling                |
| 5        | 5        | well into retry budget                           |
| 10       | 10       | likely stuck; `+10` job equates to fresh default |
| 20       | 20       | yields to almost everything                      |

Properties that make this v1-ready:

- **Indexable.** `priority - attempt` is `IMMUTABLE` — both columns are stored, no clock dependency, no FP arithmetic. PG and SQLite both support indexing on the expression directly.
- **No config.** No window to tune, no API surface to add. Pure integer subtraction.
- **Predictable.** One retry = one step demotion. Users size priority gaps relative to expected retry budgets — if retries cap at N, use a gap > N to keep legitimate-recovery jobs in their priority tier through the full retry window.
- **Engages at typical scale.** Demotion is visible at the retry counts deployments actually see (3-10), not only at pathological pile-ups.
- **Legible at debug time.** Effective priority is computable from public fields. Dashboard / users can verify ordering by inspection — pure subtraction beats explaining `floor(log2(n+1))`.

### Why not log-scale (`priority - floor(log2(attempt + 1))`)

Considered. Rejected: too soft to do its job. A `+10` job needs **1024 attempts** to demote by 10. With typical queuert retry budgets (3-10), log-scale demotion is at most 3 steps — effectively cosmetic. The formula reads as "we have demotion" but engages so weakly that genuinely-stuck jobs keep their priority slot through their entire retry life.

The original argument for log was "most retries succeed in 1-2 attempts; don't penalize legitimate recovery." But sizing priority gaps (`+10`/`0` instead of `+1`/`0`) handles that case without the formula bending — a `+10` job at `attempt = 5` is at effective `+5`, still ahead of fresh defaults. Linear gives users a knob (the gap) to tune sensitivity; log takes that knob away by making the formula nearly inert.

### Wall-clock aging: deferred to v2

Aging boosts priority based on wait time — the textbook fix for sustained-contention starvation. Three viable implementations exist (expression-in-ORDER-BY, stored `priority_at`, periodic priority-bump cleanup job), each with different tradeoffs in cost, observability, and config. None of them is obvious without a real workload to benchmark.

V1 leaves the door open and ships zero aging-incompatible decisions:

- Expression index `(priority - attempt)` doesn't preclude swapping for an aged expression in v2 — it's an index drop + recreate.
- API `priority?: number` extends naturally to `agingWindowMs?: number` later.
- The `setJobPriority` mutation API (also out of scope) plays cleanly with all three.

The user's stated case (foreground tests vs background batches) is user-paced, not machine-paced — sustained high-priority arrival is unlikely. If a real production workload reports starvation, v2 picks the implementation that fits.

## Why dedup keeps existing-job priority (no upgrade)

When `createStateJobs` finds an existing job with the same dedup key, today it returns that existing job and skips the INSERT. With priority added, the question is: if the new request specifies `priority: 10` and the existing pending job has `priority: 0`, do we upgrade the existing row?

**No, and the doc is explicit about it.** Three reasons:

1. **Race surface.** Upgrade requires a conditional UPDATE on the existing row. If the row was just acquired (`leased_until IS NOT NULL`), the UPDATE either no-ops (priority change useless) or has to roll back acquisition — neither is clean.
2. **Idempotency contract.** Today, dedup is "the work already exists, return the existing handle." Mutation-on-deduplication is a different, surprising contract — a user who calls `startChain({ priority: 0, ... })` twice and once with `priority: 10` would see persistent state changes from a call that was supposed to be a no-op.
3. **Workaround is trivial.** A user who actually needs "upgrade priority of the pending instance" can read the dedup-result job, then call a future explicit `setJobPriority` API. We don't ship that API in v1 — wait for the request.

Documented behavior: priority is set at INSERT only. Re-enqueueing with a higher priority on the same dedup key returns the existing job at its existing priority and the new priority is silently dropped. The `deduplicated: true` flag already signals "this isn't a fresh insert" so an attentive caller can see the discrepancy if they care.

## What this means concretely

### Public surface

- `StateJob.priority: number` — new field on the flat state-adapter shape. Always populated; defaults to 0 from the column default.
- `Job.priority: number` — projected through `mapStateJobToJob` unchanged. Lives on the base Job type, not gated by status.
- `StartChainEntry` (in [client.ts:146-157](../packages/core/src/client.ts#L146)) gains `priority?: number`. Optional, defaults to 0.
- The worker handler's `continueWith({ typeName, input, schedule, blockers })` (in [client.ts:684-689](../packages/core/src/client.ts#L684)) gains `priority?: number`. **Default is the parent job's priority**, not 0.

```ts
const result = await client.startChain({
  typeName: "runTest",
  input: { suiteId },
  priority: 10,   // foreground
  transactionHooks,
});

// in the worker handler, default propagation:
await complete(job, async ({ continueWith }) => {
  await continueWith({ typeName: "step2", input: ... });
  // step2 inherits parent's priority — no need to re-pass it
});

// override at a chain step:
await continueWith({ typeName: "lowImpactCleanup", input: ..., priority: -10 });
```

### Acquisition query

PG ([sql.ts:843-873](../packages/postgres/src/state-adapter/sql.ts#L843)):

```sql
WITH acquired_job AS (
  SELECT id
  FROM {{schema}}.{{table_prefix}}job
  WHERE type_name IN (SELECT unnest($1::text[]))
    AND blocked = false
    AND leased_until IS NULL
    AND completed_at IS NULL
    AND scheduled_at <= now()
  ORDER BY (priority - attempt) DESC, scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE ...
```

The WHERE predicate matches the partial index defined below; acquisition writes the lease in the same statement (per [job-model.md](job-model.md), "running" is `leased_until IS NOT NULL`, so there's no separate status flip).

The `EXISTS(... LIMIT 1)` clause that produces `has_more` doesn't need ORDER BY changes — it's just a presence check.

SQLite mirrors the change at [sql.ts](../packages/sqlite/src/state-adapter/sql.ts).

The expression must match the index expression character-for-character (after PG's normalization). A code comment ties the two together at the index definition and the acquireJob SQL — drift would silently fall back to a sort plan, which the pre-merge `EXPLAIN` check would catch.

Pure integer subtraction — `priority` and `attempt` are both stored `INTEGER` columns. No floating-point, no math functions, no portability concerns across DBs. `IMMUTABLE` everywhere.

### `getNextJobAvailableInMs` does NOT change

This method answers "when's the earliest moment I'd want to wake the worker?" The earliest wake-up is `min(scheduled_at)` regardless of priority — at that moment the worker can acquire whichever job has highest priority among the ready ones, but the wake-up is gated on availability, not selection. Keep `ORDER BY scheduled_at ASC` here.

This is a real correctness issue, not a perf nit: if the worker waited for "next high-priority job" and a low-priority job was already due, the worker would idle while the low-priority job aged. The two queries have different jobs to do and stay separately ordered.

### In-process adapter

The pending-jobs SortedSet today is keyed on `cmp.scheduledAt` ([state-adapter.in-process.ts:81-88](../packages/core/src/state-adapter/state-adapter.in-process.ts#L81)). With priority + demotion added, `acquireJob` wants `(effective_priority DESC, scheduled_at ASC)` ordering where `effective_priority = priority - attempt` — computed in JS, not stored on the record. `getNextJobAvailableInMs` still wants `min(scheduled_at)`.

Two clean options:

1. **Maintain two SortedSets per type.** `pendingByType` keyed `(effective_priority DESC, scheduled_at ASC)` for acquisition; `pendingScheduledByType` keyed `scheduled_at ASC` for wake-up. Both updated on every status transition that touches pending. Symmetric and O(log n).
2. **Single set keyed by acquisition order; scan for wake-up.** `getNextJobAvailableInMs` iterates the set to find min(scheduledAt). Cheap when the typical pending count is small but degrades on large pending backlogs.

Going with option 1. The wake-up path runs frequently (every worker tick) and a scan is the wrong asymptotic. The cost is one additional SortedSet write per `createJobs` / `unblockJobs` / `rescheduleJob` — negligible relative to the existing journaling work.

The acquisition comparator computes effective priority on the fly:

```ts
cmp.effectivePriorityScheduledAt = (a, b) => {
  const ea = a.priority - a.attempt;
  const eb = b.priority - b.attempt;
  if (ea !== eb) return eb - ea; // DESC
  return a.scheduledAt.getTime() - b.scheduledAt.getTime();
};
```

A subtle point: when `attempt` changes (acquire increments it), the SortedSet position would change. But acquire transitions the job out of pending, so it leaves the set entirely — no re-position needed. Reschedule re-inserts with the new `attempt` value. Status transitions are the only mutation paths that touch the set; in-place mutation isn't a thing.

### `createStateJobs` argument shape

Per-job input gains `priority?: number`. Default in the SQL is `COALESCE($priority, 0)` for chain starts. For continueWith jobs, the default is "inherit from parent" — implemented by:

- **PG**: `COALESCE($priority, parent.priority, 0)` in the input CTE, similar to how `chain_id` and `chain_type_name` are already inherited (see [job-model.md](job-model.md) for the parent-derived-fields pattern).
- **SQLite**: `COALESCE($priority, (SELECT priority FROM job WHERE id = $continueFromJobId), 0)`.
- **In-process**: `priority ?? parent?.priority ?? 0` at the JS layer.

The worker call site at [client.ts:705-723](../packages/core/src/client.ts#L705) threads the optional `priority` from the `continueWith` handler arg through to `createStateJobs`. When undefined, the SQL/JS picks up the parent's value. When defined, it overrides — including to a _lower_ priority (a chain that starts high-priority but runs a low-priority cleanup tail).

## Schema

### New column

Postgres + SQLite migration:

```sql
ALTER TABLE {{schema}}.{{table_prefix}}job
  ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
```

Backward-compatible: existing rows get `0`, which is the new default semantic for "no priority specified."

### Expression index swap

The acquisition index defined in [job-model.md](job-model.md) (`job_ready_idx`):

```sql
CREATE INDEX {{table_prefix}}job_ready_idx
ON {{schema}}.{{table_prefix}}job (type_name, scheduled_at)
WHERE blocked = false
  AND leased_until IS NULL
  AND completed_at IS NULL
```

Replaced with an **expression index** on the demotion formula (predicate unchanged):

```sql
CREATE INDEX {{table_prefix}}job_ready_idx
ON {{schema}}.{{table_prefix}}job
  (type_name, (priority - attempt) DESC, scheduled_at ASC)
WHERE blocked = false
  AND leased_until IS NULL
  AND completed_at IS NULL
```

Both PG and SQLite support expression indexes natively. The expression must be `IMMUTABLE`, which it is — `LN`, `FLOOR`, and arithmetic on stored columns are all immutable.

#### Why an expression index, not a stored generated column

Considered `effective_priority INTEGER GENERATED ALWAYS AS (...) STORED` with a plain index on it. Rejected primarily on **migration cost on existing deployments**:

|                       | Expression index                                             | STORED generated column                                          |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| 1M-row migration cost | Index build over the active-subset partial (~seconds)        | Full table rewrite under `AccessExclusiveLock` (~30-60s blocked) |
| Disk cost             | One btree                                                    | One btree + one INT per row                                      |
| Formula change        | `DROP INDEX` + `CREATE INDEX` over the active subset         | Another full table rewrite                                       |
| MariaDB <10.5         | Needs VIRTUAL generated column workaround when adapter ships | Native support                                                   |
| Drift risk            | ORDER BY must match index expression character-for-character | None                                                             |

The drift risk is the strongest argument for the stored column, but exactly one acquisition site references the expression. A code comment at the index definition and the `acquireJobSql` cross-references the two; conformance tests validate ordering. Acceptable.

#### Migration impact

Migration runs `DROP INDEX … ; CREATE INDEX …` as two separate statements. The new index is built only over the active subset (the partial predicate inherited from [job-model.md](job-model.md): `blocked = false AND leased_until IS NULL AND completed_at IS NULL`), so build time is bounded by the active count, not total row count. At 100K active: seconds. At 1M active: tens of seconds, still fast.

Index build takes an `AccessExclusiveLock` on the table for the duration of the rebuild. For v1, accept the brief lock and document it. If zero-downtime becomes a hard requirement later, switch the PG migration to `CREATE INDEX CONCURRENTLY` followed by `DROP INDEX CONCURRENTLY` of the old one — queuert doesn't enforce a transactional boundary around migrations, so `CONCURRENTLY` is available without wrapper-level changes.

#### `getNextJobAvailableInMs` interaction

The new index is `(type_name, effective_priority_expr DESC, scheduled_at ASC)` and the wake-up query wants `(type_name, scheduled_at ASC)` ignoring priority. Postgres will still use the index for the `type_name` filter and then sort the small filtered set by `scheduled_at`; the partial predicate (`blocked = false AND leased_until IS NULL AND completed_at IS NULL`) keeps the candidate set tiny in practice (typically hundreds, occasionally thousands). At 100K active the wake-up query is still <1 ms. Note: [job-model.md](job-model.md) already defines `job_pending_listing_idx` as `(type_name, scheduled_at)` with the same partial predicate, so the "second partial index" fallback effectively ships by default — no extra cost incurred by this design.

#### Worst-case acquisition behavior

The new ORDER BY changes how future-scheduled rows interact with the walk:

- **Old index** (`type_name, scheduled_at ASC`): future-scheduled rows are walked **last**. Workers find ready rows immediately.
- **New index** (`type_name, effective_priority DESC, scheduled_at ASC`): future-scheduled rows are interleaved by priority. Within a single priority tier they're still last (secondary sort is `scheduled_at ASC`), but across priorities the walk can hit a tier that's entirely future-scheduled before reaching ready rows at lower priorities.

Pathological case: priority 10 has 5K pending all in retry backoff (`scheduled_at` future), priority 0 has 1K ready. Acquisition walks all 5K priority-10 rows, rejects each via the `scheduled_at <= now()` filter, then reaches priority 0. Latency: ~1-2 ms cache-warm. At 100K all-future-in-top-priority, ~10 ms — borderline but bounded.

A queue type where most top-priority jobs are stuck in retry backoff is by definition unhealthy (underlying dependency down, handler always throwing). The log-scale demotion built into the same index _is_ the fix: those jobs demote out of priority 10 within a few retry cycles, and the walk shortens automatically. The pathology is self-healing.

Validation: pre-merge benchmark explicitly seeds this pathology and asserts <5 ms p99 acquisition latency.

### Column type

`INTEGER` (signed) on both PG and SQLite. PG's `int4` range is ±2.1B — far beyond any sane priority value, so we don't reach for `int2`. SQLite stores integers as variable-width on disk anyway, so the declared type is mostly documentation.

## Touchpoints

1. `packages/core/src/state-adapter/state-adapter.ts` — add `priority: number` to `StateJob`; add `priority?: number` to `createJobs` per-job input.
2. `packages/core/src/entities/job.types.ts` — add `priority: number` to `Job` base.
3. `packages/core/src/entities/job.ts` (`mapStateJobToJob`) — project `priority`.
4. `packages/core/src/client.ts`:
   - `StartChainEntry` gains `priority?: number`.
   - `startChains` / `startChain` impls thread `priority` through to `createStateJobs`.
   - `continueWith` handler signature gains `priority?: number`.
   - The wrapper at lines 705-723 threads `priority` (defaulting to undefined, letting the SQL/JS resolve to parent).
5. `packages/core/src/implementation/start-chains.ts` — pass `priority` through to `createStateJobs`.
6. `packages/core/src/implementation/continue-with.ts` — accept `priority?: number`, pass through.
7. `packages/core/src/implementation/create-state-jobs.ts` — pass `priority` through to the adapter call.
8. `packages/postgres/src/state-adapter/sql.ts`:
   - Migration: add column + drop/recreate `job_ready_idx` as an expression index. Predicate unchanged from [job-model.md](job-model.md) (`blocked = false AND leased_until IS NULL AND completed_at IS NULL`); only the columns expand to include the demotion expression.
   - `dbJobColumns` / row mapping: include `priority`.
   - `acquireJobSql`: WHERE clause keeps the structural predicate from job-model.md; `ORDER BY (priority - attempt) DESC, scheduled_at ASC`. Cross-reference the index definition in a comment so future edits keep them in sync.
   - `createJobsSql`: insert `priority` with `COALESCE` over input + parent + 0.
   - All SELECTs returning `StateJob` already use `*` or `dbJobColumns`; verify.
9. `packages/sqlite/src/state-adapter/sql.ts` — same changes as PG.
10. `packages/core/src/state-adapter/state-adapter.in-process.ts`:
    - `cmp.effectivePriorityScheduledAt` (new) → SortedSet for acquisition. Computes `priority - Math.floor(Math.log2(attempt + 1))` on each comparison.
    - `pendingScheduledByType` (new) → SortedSet for wake-up.
    - Both maintained on every pending-set membership change.
    - Inheritance logic at create time: `priority ?? parentJob?.priority ?? 0`.
11. `packages/core/src/conformance/state-adapter-cases/` — new cases:
    - High-priority job acquired before low-priority with earlier `scheduled_at`.
    - Equal-priority FIFO falls back to `scheduled_at`.
    - **Demotion: a `priority: 10` job at `attempt = 6` is acquired _after_ a fresh `priority: 5` job** (effective +4 vs +5) — verifies the linear formula is wired through.
    - **Demotion threshold: a `priority: 10` job at `attempt = 11` is acquired _after_ a fresh `priority: 0` job** (effective -1 vs 0).
    - `continueWith` without explicit priority inherits parent's.
    - `continueWith` with explicit priority overrides parent's (including to lower).
    - Dedup of an existing pending job with new higher priority returns the existing job at its existing priority.
    - `getNextJobAvailableInMs` returns the earliest `scheduled_at` regardless of priority and regardless of attempt count.
12. `packages/core/src/suites/client-queries.test-suite.ts` — add a priority-ordering case alongside the existing chain tests.
13. `packages/dashboard/src/api/routes/jobs.ts` + UI — surface `priority` in the job detail panel; add a `priority` column to job lists (sortable in v2; v1 is read-only display).
14. `packages/dashboard/src/specs/api.spec.ts` — extend a fixture chain to include a non-default priority and assert it round-trips.
15. `packages/otel/src/...` — emit `priority` as a span attribute on job-process spans (low-cardinality enough at typical `-10`/`0`/`10` usage; users using high-cardinality numeric priorities can disable).
16. `docs/src/content/docs/advanced/job-processing.md` — new section: "Priority", documenting numeric semantics, the strict-no-aging tradeoff, the dedup-no-upgrade rule, the inheritance default, and the type-name/worker-pool starvation mitigations.
17. Examples: a new `examples/priority-foreground-background/` showing a single chain type with two enqueue paths (foreground at priority 10, background at default) sharing a worker pool.

## Alternatives rejected

### Named priority tiers (`"high" | "normal" | "low"`)

Already covered above. Numeric is more flexible, matches storage exactly, and avoids the "what does `medium` mean?" debate. Self-documentation is left to user-side constants — the library doesn't export named priority values.

### Wall-clock aging in v1

Considered shipping wall-clock aging in v1 alongside log-scale demotion. Deferred — see [Why log-scale demotion in v1, wall-clock aging in v2](#why-log-scale-demotion-in-v1-wall-clock-aging-in-v2). Three viable implementations exist (expression-in-ORDER-BY, stored `priority_at`, periodic priority-bump cleanup job); picking the right one without a real workload to benchmark is premature. V1 leaves the door open with no aging-incompatible decisions.

### Stored generated `effective_priority` column

Considered `effective_priority INTEGER GENERATED ALWAYS AS (...) STORED` instead of an expression index. Rejected primarily on migration cost — full table rewrite under `AccessExclusiveLock` on existing 1M-row deployments. See [Why an expression index, not a stored generated column](#why-an-expression-index-not-a-stored-generated-column).

### Log-scale demotion (`priority - floor(log2(attempt + 1))`) instead of linear

Considered. Rejected: too soft to do its job. With log demotion a `+10` job needs **1024 attempts** to demote by 10 — at typical queuert retry budgets (3-10) demotion never reaches 4 steps. The formula reads as "we have demotion" but engages so weakly that genuinely-stuck jobs keep their priority slot through their full retry life.

Linear gives users a tunable knob: pick a priority gap larger than the expected retry budget and legitimate-recovery jobs retain priority through the full retry window; genuinely-stuck jobs visibly yield by the time they cross the gap. Log removes that knob by making demotion nearly inert.

### Per-type priority configuration

I.e. configure on `defineJobType({ priority: 10 })` instead of per-job. Rejected — the user's whole reason for wanting priority is that the _same_ job type runs at different priorities depending on enqueue context. Per-type would just be a worse version of "use separate type names," which already works.

### Priority in `getNextJobAvailableInMs`

Wake-up considers only the highest-priority pending job. Rejected — see "this method does NOT change" section. Causes idle workers when low-priority work is ready and high-priority work is scheduled future.

### Dedup upgrade-on-re-enqueue

I.e. `startChain` with a higher priority bumps an existing dedup'd pending job. Rejected — see "Why dedup keeps existing-job priority." Adds a hidden mutation to a no-op call. Users who need this can read-then-set via a future explicit API.

### Dynamic priority adjustment (`setJobPriority(id, n)`)

Out of scope for v1. Easy to add later if a use case appears: an UPDATE conditioned on the same structural predicate as acquisition (`blocked = false AND leased_until IS NULL AND completed_at IS NULL`) — running jobs are out of the queue, blocked jobs aren't yet eligible, completed ones are terminal. No schema change needed.

### Floating-point priority

Considered briefly to support fractional ordering ("between 0 and 1"). Rejected — pure noise. Users wanting fine-grained ordering can use larger integer ranges. Floats also have NaN and infinity edge cases that don't belong in an ORDER BY.

### Replacing `scheduled_at`-based scheduling with priority

I.e. priority _is_ the schedule. Rejected — they're orthogonal. `scheduled_at` is "when can this run"; `priority` is "of the things that can run, which first." Conflating them re-creates the manual-skew footgun the user already discounted.

## Pre-merge validation

- `EXPLAIN (ANALYZE, BUFFERS)` on `acquireJobSql` against a seeded DB (~100K pending jobs across multiple type names with varying priorities) confirming the new expression partial index is used and no sort-after-fetch / seqscan appears in the plan. The expression in EXPLAIN's `Index Cond` and `Order By` should match `acquireJobSql`'s ORDER BY character-for-character.
- `EXPLAIN` on `getNextJobAvailableInMsSql` against the same DB — confirm performance hasn't regressed past 1 ms; if it has, ship the second partial index.
- Conformance suite: all eight new cases listed in [Touchpoints](#touchpoints) item 11 pass on PG, SQLite, and in-process.
- Race test: 50 concurrent workers acquiring against a pool of 1000 mixed-priority pending jobs — confirm strict-priority-with-demotion order is preserved across acquisitions (effective-priority-highest all picked up before any lower-effective drains).
- **Pathological-acquisition benchmark**: seed 50K priority-10 jobs all `scheduled_at = now() + 5min`, 1K priority-0 jobs ready. Measure acquisition latency. Target: <5 ms p99. Verifies the future-scheduled-top-tier scan extension stays bounded.
- Migration test: pre-migration DB with 100K existing pending jobs — migration runs in seconds, all rows get `priority = 0`, post-migration acquisition order matches FIFO for equal-priority (regression check).
- A smoke benchmark: per-second job throughput on a single-type pool with all `priority = 0`, `attempt = 0` jobs, before vs after — confirm no regression from the wider expression index.

## What this doesn't do

- **No `setJobPriority` mutation API.** Out of scope; add later if asked.
- **No wall-clock aging.** Log-scale demotion handles failure-driven yielding; sustained-arrival starvation is a documented v1 footgun, deferred to v2.
- **No priority on `triggerJob`.** Trigger is a `scheduled_at` reset, not a priority bump.
- **No priority on blockers.** A blocker chain has its own root-job priority from its own `startChain` call.
- **No `priority` filter in `listJobs` / `listChains`.** Add when a use case appears (likely never — users filter by type/status, then sort by priority is a UI concern, not a query concern).
- **No backpressure / fairness across type names.** Priority is per-type-pool. A high-priority job of type A doesn't preempt or rank against a low-priority job of type B; the worker's `typeNames` filter and per-type acquisition handle that orthogonally.
- **No way to disable demotion.** It's part of the acquisition formula, not opt-in. A user who really wants "this priority +10 job runs first regardless of how many times it's failed" picks a wider priority gap — `+1000` survives 1000 retries before equating to default.
