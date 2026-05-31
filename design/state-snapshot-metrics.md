# State-snapshot metrics

> **Builds on**: [job-model.md](job-model.md) — uses the derived `status`, the `blocked` / `leased_until` / `completed_at` / `continued_to_job_id` structural columns, and the active-partition partial indexes defined there.

Add an opt-in OTel layer that emits gauges derived by periodically scanning the `job` table, complementing the existing event-driven histograms in [observability-adapter.ts](../packages/core/src/observability-adapter/observability-adapter.ts).

## Problem

The current `ObservabilityAdapter` emits everything from in-band events: `chainDuration`, `jobDuration`, `jobAttemptDuration`, the `*Started`/`*Completed`/`*Failed` callbacks. That works for things that _transition_. It cannot see things that _don't_:

- A chain or job that's in flight right now — there's no event for "still going."
- The current backlog by type/status — counts are state, not events.

Today's options for getting these signals are: query `listChains` / `listJobs` from the dashboard, or eyeball the DB. Neither is something you can alert on in OTel.

We want a small set of gauges, derived from a periodic scan, that give an operator the live picture: how much work is in flight and how stale. (A "this job/chain is stuck on retries" signal was originally planned here too, but is blocked on a replacement stuck-detection signal — see [Open questions](#open-questions).)

## Proposed gauges

Four gauges, symmetric jobs/chains pairs. The chain itself is just `running` / `completed` per [job-model.md](job-model.md). When reporting metrics on running chains we want finer-grained "what is the chain _currently doing_?" detail, which is the frontier job's derived job-status. Note the two senses of "running": a _chain_ is `running` when it is not yet completed (`completed_at IS NULL` on its frontier), whereas a _job_ is `running` (job-status) only when it holds a live lease (`leased_until IS NOT NULL`). A running chain's frontier job may be in any non-completed job state — pending (blocked / scheduled / ready) or running (leased).

| Gauge                                  | Semantic                                                                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `running_jobs{type, state}`            | Count of jobs whose `status ≠ 'completed'`, by job type and derived state. `running` is a top-level status; `pending` jobs are split into their `blocked` / `scheduled` / `ready` sub-states. |
| `running_chains{type, state}`          | Count of chains in `running` chain-status, grouped by chain type and the frontier job's derived state (same `running` / `blocked` / `scheduled` / `ready` breakdown)                          |
| `oldest_ready_job_age_seconds{type}`   | `now() - MIN(scheduled_at)` over jobs deriving as `ready` (i.e. `blocked = false AND leased_until IS NULL AND completed_at IS NULL AND scheduled_at ≤ now()`), by type                        |
| `oldest_ready_chain_age_seconds{type}` | Same as above but over chains whose frontier job derives as `ready`, by chain type                                                                                                            |

Notes on naming and semantics:

- "Running" (in the gauge names) tracks the chain-status vocabulary in [job-model.md](job-model.md) (`'running' | 'completed'`): a job counts toward `running_jobs` if it is not completed — i.e. `completed_at IS NULL`. This is the chain-level sense of "running" (= not completed), distinct from the frontier job's finer-grained derived state, where job-status `running` means a live lease. The `state` label carries the finer breakdown: the top-level `running` job-status, plus the `pending` sub-states `blocked` / `scheduled` / `ready`. (`blocked`, `scheduled`, and `ready` are not statuses — they are attributes/sub-states of `pending`; see [job-model.md](job-model.md).) The dedup `scope: 'incomplete' | 'any'` uses the same "not completed" notion of activity.
- "Oldest" means _lag_ (`scheduled_at`-derived) and is only meaningful on `ready` jobs (scheduled-for-later jobs have no lag yet — their `scheduled_at` is in the future). Lifetime metrics (oldest existing chain regardless of state) are not gauges; if needed they're better as offline `listChains` queries.

## Schema dependencies

This package adds **no columns** of its own. It depends on schema defined in [job-model.md](job-model.md):

- `blocked`, `leased_until`, `completed_at`, `continued_to_job_id` — the structural columns this layer reads.

## Indexes

This layer reuses the active-partition partial indexes defined in [job-model.md](job-model.md) (`job_pending_listing_idx`, `job_blocked_listing_idx`, `job_running_idx`, `job_chain_tail_idx`). It adds no indexes of its own: the gauges below are served entirely by those existing partials.

**Hard dependency: cleanup job must run.** The active-partition partials keep aggregate cost bounded by the active working set; without cleanup that assumption breaks down and aggregate cost grows with lifetime job count.

(The stuck-detection gauges previously planned here carried a dedicated `job_stuck_idx`; that index is deferred along with the gauges — see [Open questions](#open-questions).)

## Queries

```sql
-- oldest_ready_job_age_seconds
SELECT type_name, MIN(scheduled_at)
FROM job
WHERE blocked = false
  AND leased_until IS NULL
  AND completed_at IS NULL
  AND scheduled_at <= now()
GROUP BY type_name;

-- running_jobs (counts grouped by derived state over the active partition)
-- 'running' is the top-level leased status; the remaining rows are 'pending',
-- split into their blocked / scheduled / ready sub-states.
SELECT
  type_name,
  CASE
    WHEN leased_until IS NOT NULL THEN 'running'
    WHEN blocked                  THEN 'blocked'
    WHEN scheduled_at > now()     THEN 'scheduled'
                                  ELSE 'ready'
  END AS state,
  COUNT(*)
FROM job
WHERE completed_at IS NULL
GROUP BY type_name, state;

-- running_chains + oldest_ready_chain_age (single scan over chain frontiers)
WITH frontier AS (
  SELECT chain_id, chain_type_name, blocked, leased_until,
         completed_at, scheduled_at
  FROM job
  WHERE continued_to_job_id IS NULL
    AND completed_at IS NULL          -- restrict to running chains
)
SELECT
  chain_type_name,
  CASE
    WHEN leased_until IS NOT NULL THEN 'running'
    WHEN blocked                  THEN 'blocked'
    WHEN scheduled_at > now()     THEN 'scheduled'
                                  ELSE 'ready'
  END AS state,
  COUNT(*) AS running_count,
  MIN(scheduled_at) FILTER (
    WHERE leased_until IS NULL AND NOT blocked AND scheduled_at <= now()
  ) AS oldest_ready
FROM frontier
GROUP BY chain_type_name, state;
```

Chain-frontier insight: for a running chain, the frontier job (`continued_to_job_id IS NULL`) is necessarily `completed_at IS NULL`. The `job_chain_tail_idx` (UNIQUE partial on `(chain_id) WHERE continued_to_job_id IS NULL AND completed_at IS NULL`) lets the frontier scan touch one row per chain.

Per-collection cost is dominated by the active-partition scan plus the partial-index walk on `job_chain_tail_idx` — order of milliseconds while the working set is in the tens of thousands. Collection cadence ~60s, so the runner is doing ~one to four index scans per minute, all on partial indexes that don't touch completed history.

Write amplification: every active-partition partial index ([job-model.md](job-model.md)) touches the hot path on transitions in/out of completion. Worth measuring against `processing-capacity` before committing.

## Architecture

### Recurring job + observable callbacks

Two layers:

1. **A periodic job type** — e.g. `queuert.metrics` — registered via `defineJobTypes` and `createProcessors`, modeled exactly like [showcase-cleanup](../examples/showcase-cleanup/src/index.ts): self-rescheduling chain, `deduplication: { key: 'queuert.metrics', scope: 'incomplete' }` to ensure single-runner across multiple worker processes. Each run executes the queries above and writes the result into an in-memory snapshot.

2. **An OTel `ObservableGauge` layer** — registers callbacks against the OTel Meter that read from the in-memory snapshot. Scrape/export cadence (typically 30s) is independent from the DB poll cadence (e.g. 60s); the callback never blocks on the DB.

The two cadences are decoupled deliberately: OTel collection sees the most recent snapshot, the metrics job runs at its own cost-optimal rate, and one DB query per period yields all four gauges (combined into one or two SQL statements).

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
  // `mode: "single-runner-shared" | "per-process"` once decided
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

- **Postgres** ([packages/postgres](../packages/postgres)): no metrics-specific index. Aggregate queries above are PG-native and run on the active-partition partials from job-model.md.
- **SQLite** ([packages/sqlite](../packages/sqlite)): same — no added index. The chain-frontier queries don't need `DISTINCT ON` (the UNIQUE partial `job_chain_tail_idx` from job-model.md returns one row per chain directly).
- **In-process** ([state-adapter.in-process.ts](../packages/core/src/state-adapter/state-adapter.in-process.ts)): aggregate queries become plain JS reductions over the in-memory map. No index considerations.

State adapter contract gains a single new method:

- `getMetricsSnapshot()` that returns all aggregates in one call. Single method preferred over one-per-gauge — keeps the dialect-specific query in the adapter and matches the "one DB round-trip per period" goal.

No further adapter signature changes are required for these gauges.

## Migration

The metrics layer ships as an additive package — no schema changes beyond what [job-model.md](job-model.md) provides, and no indexes of its own (the gauges run on the active-partition partials already defined there).

The `@queuert/otel-state` package is entirely opt-in — installing it has no effect until the user wires the metrics job into their worker.

## Open questions

1. **Single-runner snapshot distribution.** (a) DB-stored snapshot, (b) per-process scans, or (c) single-runner only. Drives package API.
2. **`getMetricsSnapshot` shape.** One method with all aggregates vs one method per gauge family. Preferred: one method, returns a typed snapshot record.
3. **Should `running_jobs` / `running_chains` skip the `blocked` and `scheduled` sub-states?** Blocked work is running (not completed) in the literal sense but isn't lag-relevant — it's waiting on something else by design. Same for `scheduled` (waiting on time). Probably keep them but document semantics.
4. **`stuck_jobs{type}` / `stuck_chains{type}` — BLOCKED on a replacement stuck-detection signal.** These gauges count active jobs/chains whose auto-retry streak has advanced without progress ("this is stuck"), grouped by job type vs chain type (which step is failing vs which workflow is stalled). They were originally built on the `attempts_since_user_reschedule` counter, which the settled [job-model.md](job-model.md) **removed** (along with the `userInitiated` plumbing that maintained it); there is no replacement counter today. The gauges cannot ship until a new stuck-detection signal is chosen. Once a signal exists, both the SQL (a `WHERE … >= $threshold` filter over the active partition, two group-bys) and a backing index (the former `job_stuck_idx`, an active-partition partial on `(type_name, chain_type_name)` plus the new signal's predicate) will need to be redefined against it, and the package will re-expose a `stuck: { threshold: N }` config (conservative default, e.g. 5). Until then the concept is deferred, not abandoned.
5. **Histogram of `attempt` distribution.** A bucketed `attempt_distribution{type, bucket}` gauge would let users alert on "many jobs at high retry counts" without baking a threshold into the package. Worth a follow-up; not in v1. (May also serve as raw material for the stuck-detection signal above.)
