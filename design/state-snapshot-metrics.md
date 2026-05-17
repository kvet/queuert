# State-snapshot metrics

> **Builds on**: [job-model.md](job-model.md) — uses the derived `status`, the `has_open_blockers` / `leased_until` / `completed_at` / `succeeded_by_job_id` structural columns, the `last_user_reschedule_attempt` field, and the active-partition partial indexes defined there.

Add an opt-in OTel layer that emits gauges derived by periodically scanning the `job` table, complementing the existing event-driven histograms in [observability-adapter.ts](../packages/core/src/observability-adapter/observability-adapter.ts).

## Problem

The current `ObservabilityAdapter` emits everything from in-band events: `chainDuration`, `jobDuration`, `jobAttemptDuration`, the `*Started`/`*Completed`/`*Failed` callbacks. That works for things that _transition_. It cannot see things that _don't_:

- A chain or job that's in flight right now — there's no event for "still going."
- A job that keeps failing without being rescheduled forward — every event fires the same way; nothing surfaces "this is stuck."
- The current backlog by type/status — counts are state, not events.

Today's options for getting these signals are: query `listChains` / `listJobs` from the dashboard, or eyeball the DB. Neither is something you can alert on in OTel.

We want a small set of gauges, derived from a periodic scan, that give an operator the live picture: how much work is in flight, how stale, and how many active workflows are stalled because retries aren't progressing.

## Proposed gauges

Six gauges, symmetric jobs/chains pairs. "Chain status" here means the chain-frontier job's _job_ status (the chain itself is just `open` / `closed` per [job-model.md](job-model.md); when reporting metrics on open chains we want finer-grained "what is the chain _currently doing_?" detail, which is the frontier job's job-status).

| Gauge                                  | Semantic                                                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open_jobs{type, status}`              | Count of jobs whose `status ≠ 'completed' AND status ≠ 'continued'`, by job type and derived status (`blocked` / `scheduled` / `ready` / `running`)                              |
| `open_chains{type, status}`            | Count of chains in `open` status, grouped by chain type and the frontier job's derived status                                                                                    |
| `oldest_ready_job_age_seconds{type}`   | `now() - MIN(scheduled_at)` over jobs deriving as `ready` (i.e. `has_open_blockers = false AND leased_until IS NULL AND completed_at IS NULL AND scheduled_at ≤ now()`), by type |
| `oldest_ready_chain_age_seconds{type}` | Same as above but over chains whose frontier job derives as `ready`, by chain type                                                                                               |
| `stuck_jobs{type}`                     | Count of jobs deriving as `ready` whose `(attempt - COALESCE(last_user_reschedule_attempt, 0)) ≥ N`                                                                              |
| `stuck_chains{type}`                   | Count of chains whose frontier job is stuck (one stuck frontier per chain by construction)                                                                                       |

Notes on naming and semantics:

- "Open" matches the chain-status vocabulary in [job-model.md](job-model.md) (`'open' | 'closed'`) and the dedup `scope: 'open' | 'any'`. A job is "open" if its status is one of `blocked | scheduled | ready | running` — i.e. `completed_at IS NULL`.
- "Oldest" means _lag_ (`scheduled_at`-derived) and is only meaningful on `ready` jobs (scheduled-for-later jobs have no lag yet — their `scheduled_at` is in the future). Lifetime metrics (oldest existing chain regardless of state) are not gauges; if needed they're better as offline `listChains` queries.
- `stuck_jobs` and `stuck_chains` count the same row set, grouped differently — by job type vs chain type. Both views are useful: which step type is failing, vs which workflow type is stalled.
- The stuck-threshold is computed as `attempt - COALESCE(last_user_reschedule_attempt, 0)` (the streak of auto-retries since the last user reschedule); the `last_user_reschedule_attempt` column is defined in [job-model.md](job-model.md).

## Schema dependencies

This package adds **no columns** of its own. It depends on schema defined in [job-model.md](job-model.md):

- `last_user_reschedule_attempt int NULL` — set to the value of `attempt` when `rescheduleJob` is called via user-thrown `RescheduleJobError`; left alone on default-backoff retries. The user-vs-default distinction lives in [handle-job-handler-error.ts:43](../packages/core/src/implementation/handle-job-handler-error.ts#L43); plumbing must thread `userInitiated` through to the adapter.
- `has_open_blockers`, `leased_until`, `completed_at`, `succeeded_by_job_id` — the structural columns this layer reads.

## Indexes

This layer reuses the active-partition partial indexes defined in [job-model.md](job-model.md) (`job_pending_listing_idx`, `job_blocked_listing_idx`, `job_running_idx`, `job_chain_tail_idx`). One metrics-specific addition:

```sql
-- Drives stuck_jobs and stuck_chains: ready jobs whose retry streak has advanced past
-- the last user reschedule. Cardinality is naturally tiny (only jobs failing without
-- user intervention).
CREATE INDEX job_stuck_idx ON job (type_name, chain_type_name)
  WHERE has_open_blockers = false
    AND leased_until IS NULL
    AND completed_at IS NULL
    AND scheduled_at <= now()       -- ready, not just pending
    AND attempt > COALESCE(last_user_reschedule_attempt, 0);
```

Cardinality is bounded by the active working set. **Hard dependency: cleanup job must run.** Without it, the active-set assumption breaks down and aggregate cost grows with lifetime job count.

The `now()` clause is `IMMUTABLE`-violating and so can't go in the partial-index predicate on Postgres; in practice the index is partial on the structural-only conditions and the `scheduled_at <= now()` filter runs at query time. The same logic applies to SQLite. (Functionally equivalent; the partial just covers slightly more rows than the strict "ready" definition.)

## Queries

```sql
-- oldest_ready_job_age_seconds
SELECT type_name, MIN(scheduled_at)
FROM job
WHERE has_open_blockers = false
  AND leased_until IS NULL
  AND completed_at IS NULL
  AND scheduled_at <= now()
GROUP BY type_name;

-- open_jobs (counts grouped by derived status over the active partition)
SELECT
  type_name,
  CASE
    WHEN leased_until IS NOT NULL THEN 'running'
    WHEN has_open_blockers        THEN 'blocked'
    WHEN scheduled_at > now()     THEN 'scheduled'
                                  ELSE 'ready'
  END AS status,
  COUNT(*)
FROM job
WHERE completed_at IS NULL
GROUP BY type_name, status;

-- open_chains + oldest_ready_chain_age (single scan over chain frontiers)
WITH frontier AS (
  SELECT chain_id, chain_type_name, has_open_blockers, leased_until,
         completed_at, scheduled_at
  FROM job
  WHERE succeeded_by_job_id IS NULL
    AND completed_at IS NULL          -- restrict to open chains
)
SELECT
  chain_type_name,
  CASE
    WHEN leased_until IS NOT NULL THEN 'running'
    WHEN has_open_blockers        THEN 'blocked'
    WHEN scheduled_at > now()     THEN 'scheduled'
                                  ELSE 'ready'
  END AS status,
  COUNT(*) AS open_count,
  MIN(scheduled_at) FILTER (
    WHERE leased_until IS NULL AND NOT has_open_blockers AND scheduled_at <= now()
  ) AS oldest_ready
FROM frontier
GROUP BY chain_type_name, status;

-- stuck_jobs and stuck_chains (same scan, two group-bys)
SELECT type_name, chain_type_name, COUNT(*)
FROM job
WHERE has_open_blockers = false
  AND leased_until IS NULL
  AND completed_at IS NULL
  AND scheduled_at <= now()
  AND (attempt - COALESCE(last_user_reschedule_attempt, 0)) >= $1
GROUP BY type_name, chain_type_name;
```

Chain-frontier insight: for an open chain, the frontier job (`succeeded_by_job_id IS NULL`) is necessarily `completed_at IS NULL`. The `job_chain_tail_idx` (UNIQUE partial on `(chain_id) WHERE succeeded_by_job_id IS NULL`) lets the frontier scan touch one row per chain.

Per-collection cost is dominated by the active-partition scan plus the partial-index walk on `job_chain_tail_idx` — order of milliseconds while the working set is in the tens of thousands. Collection cadence ~60s, so the runner is doing ~one to four index scans per minute, all on partial indexes that don't touch completed history.

Write amplification: every active-partition partial index ([job-model.md](job-model.md)) touches the hot path on transitions in/out of completion; `job_stuck_idx` (added here) updates only on failure-path retries, which are low-frequency. Worth measuring against `processing-capacity` before committing.

## Architecture

### Recurring job + observable callbacks

Two layers:

1. **A periodic job type** — e.g. `queuert.metrics` — registered via `defineJobTypes` and `createProcessors`, modeled exactly like [showcase-cleanup](../examples/showcase-cleanup/src/index.ts): self-rescheduling chain, `deduplication: { key: 'queuert.metrics', scope: 'incomplete' }` to ensure single-runner across multiple worker processes. Each run executes the queries above and writes the result into an in-memory snapshot.

2. **An OTel `ObservableGauge` layer** — registers callbacks against the OTel Meter that read from the in-memory snapshot. Scrape/export cadence (typically 30s) is independent from the DB poll cadence (e.g. 60s); the callback never blocks on the DB.

The two cadences are decoupled deliberately: OTel collection sees the most recent snapshot, the metrics job runs at its own cost-optimal rate, and one DB query per period yields all six gauges (combined into one or two SQL statements).

### Open question: single-runner vs per-process

The dedup-key approach keeps exactly one metrics job in flight at a time across all worker processes. That's correct for _DB load_ (one scan per period regardless of fleet size) but raises a distribution problem: only the runner's process has fresh snapshot data. Other processes' OTel callbacks have nothing to emit unless the snapshot is shared.

Three resolutions:

- **(a) Single-runner, snapshot stored in DB** — write the snapshot row to a `metrics_snapshot` table; every process reads the latest row in its OTel callback. Decouples the job from the emit, but adds a read on every scrape (cheap, single-row by primary key).
- **(b) Per-process scans, no dedup** — drop the dedup; each process polls independently, each emits its own snapshot. N× DB load but no cross-process state, and per-process dashboards work naturally.
- **(c) Single-runner only** — accept that only one process emits, others no-op. Simplest, but breaks the "every process can be scraped" expectation; not a serious option for production.

Resolution affects the package API and is the largest open question. Default leaning is **(a)** for fleets >1 worker, falling back to **(b)** as a configuration choice.

## Package shape

This ships as a separate package — `@queuert/otel-state` (or similar) — to keep `@queuert/core` free of OTel dependencies and to make the metrics job opt-in.

API outline (subject to change pending the open question above):

```ts
import { defineMetricsJob } from "@queuert/otel-state";

const metrics = defineMetricsJob({
  client,
  meter, // OTel Meter from @opentelemetry/api
  intervalMs: 60_000,
  stuck: { threshold: 5 }, // (attempt - last_user_reschedule_attempt) >= threshold
  // or `mode: "single-runner-shared" | "per-process"` once decided
});

const worker = await createInProcessWorker({
  client,
  processors: [metrics.processors, ...userProcessors],
});

await metrics.scheduleInitial(); // analogous to scheduling cleanup
```

`defineMetricsJob` returns the `JobTypes` + `Processors` registry pair plus an `ObservableGauge`-registering callback that the user wires into their meter. Final shape lands once the snapshot-distribution question is settled.

## Cross-adapter implications

The underlying schema (column adds, base indexes, status derivation) is owned by [job-model.md](job-model.md). This layer adds only:

- **Postgres** ([packages/postgres](../packages/postgres)): one metrics-specific index (`job_stuck_idx`). Aggregate queries above are PG-native. `acquireJob` and `rescheduleJob` SQL maintain `last_user_reschedule_attempt` per job-model.md.
- **SQLite** ([packages/sqlite](../packages/sqlite)): same `job_stuck_idx` (modulo SQLite partial-index syntax). The chain-frontier queries don't need `DISTINCT ON` (the UNIQUE partial `job_chain_tail_idx` from job-model.md returns one row per chain directly).
- **In-process** ([state-adapter.in-process.ts](../packages/core/src/state-adapter/state-adapter.in-process.ts)): aggregate queries become plain JS reductions over the in-memory map. No index considerations.

State adapter contract gains a single new method:

- `getMetricsSnapshot()` that returns all aggregates in one call. Single method preferred over one-per-gauge — keeps the dialect-specific query in the adapter and matches the "one DB round-trip per period" goal.

`rescheduleJob` already accepts `userInitiated` per [job-model.md](job-model.md); no further signature changes here.

## Migration

The metrics layer ships as an additive package — no schema changes beyond what [job-model.md](job-model.md) provides. The only addition is `job_stuck_idx`, applied lazily when `@queuert/otel-state` is first installed and the worker boots (or via a one-time migration shipped with the package).

The `@queuert/otel-state` package is entirely opt-in — installing it has no effect until the user wires the metrics job into their worker.

## Open questions

1. **Single-runner snapshot distribution.** (a) DB-stored snapshot, (b) per-process scans, or (c) single-runner only. Drives package API.
2. **`stuck` threshold default.** What value of N is the right "stuck" default? Likely workload-dependent; package should expose it but pick a conservative default (e.g. 5).
3. **`getMetricsSnapshot` shape.** One method with all aggregates vs one method per gauge family. Preferred: one method, returns a typed snapshot record.
4. **Should `open_jobs` / `open_chains` skip the `blocked` and `scheduled` statuses?** Blocked work is open in the literal sense but isn't lag-relevant — it's waiting on something else by design. Same for `scheduled` (waiting on time). Probably keep them but document semantics.
5. **Histogram of `attempt` distribution.** A bucketed `attempt_distribution{type, bucket}` gauge would let users alert on "many jobs at high retry counts" without baking a threshold into the package. Worth a follow-up; not in v1.
