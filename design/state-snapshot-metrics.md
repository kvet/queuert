# State-snapshot metrics

Add an opt-in OTel layer that emits gauges derived by periodically scanning the `job` table, complementing the existing event-driven histograms in [observability-adapter.ts](../packages/core/src/observability-adapter/observability-adapter.ts).

## Problem

The current `ObservabilityAdapter` emits everything from in-band events: `chainDuration`, `jobDuration`, `jobAttemptDuration`, the `*Started`/`*Completed`/`*Failed` callbacks. That works for things that _transition_. It cannot see things that _don't_:

- A chain or job that's in flight right now — there's no event for "still going."
- A job that keeps failing without being rescheduled forward — every event fires the same way; nothing surfaces "this is stuck."
- The current backlog by type/status — counts are state, not events.

Today's options for getting these signals are: query `listChains` / `listJobs` from the dashboard, or eyeball the DB. Neither is something you can alert on in OTel.

We want a small set of gauges, derived from a periodic scan, that give an operator the live picture: how much work is in flight, how stale, and how many active workflows are stalled because retries aren't progressing.

## Proposed gauges

Six gauges, symmetric jobs/chains pairs. "Chain status" is the terminal job's status (matches `listChains` semantics in [state-adapter.pg.ts:465](../packages/postgres/src/state-adapter/state-adapter.pg.ts#L465)), so the `status` label is interchangeable across the two families.

| Gauge                                    | Semantic                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `incomplete_jobs{type, status}`          | Count of jobs not in `completed`, by job type and status (`pending` / `running` / `blocked`)                                         |
| `incomplete_chains{type, status}`        | Count of chains whose terminal job isn't `completed`, by chain type and terminal-job status                                          |
| `oldest_pending_job_age_seconds{type}`   | `now() - MIN(scheduled_at)` over pending jobs by type — the lag of the slowest-moving job class                                      |
| `oldest_pending_chain_age_seconds{type}` | `now() - MIN(terminal.scheduled_at)` over chains whose terminal is pending, by chain type — lag of the slowest-moving workflow class |
| `stuck_jobs{type}`                       | Count of pending jobs that have retried `>= N` times without the user calling `rescheduleJob`                                        |
| `stuck_chains{type}`                     | Count of chains whose terminal job is stuck (one stuck active job per chain by construction)                                         |

Notes on naming and semantics:

- "Incomplete" is used in preference to "running" — chain status maps to a job status enum, but a chain spends very little time literally `running` (most live time is `pending` waiting for a worker, or `blocked`). "Incomplete" matches the existing `dedup.scope='incomplete'` vocabulary in [sql.ts:435](../packages/postgres/src/state-adapter/sql.ts#L435).
- "Oldest" means _lag_ (`scheduled_at`-derived), only meaningful on `pending`. Lifetime metrics (oldest existing chain regardless of state) are not gauges; if needed they're better as offline `listChains` queries.
- `stuck_jobs` and `stuck_chains` count the same row set, grouped differently — by job type vs chain type. Both views are useful: which step type is failing, vs which workflow type is stalled.

## Schema change

Add one column on `job`:

```sql
attempts_since_reschedule INTEGER NOT NULL DEFAULT 0
```

Maintained alongside `attempt`:

- **`acquireJob`**: increment by 1 (next to the existing `attempt = attempt + 1` in [sql.ts:837](../packages/postgres/src/state-adapter/sql.ts#L837)).
- **`rescheduleJob`** when called via user-thrown `RescheduleJobError`: reset to 0.
- **`rescheduleJob`** when called via the default-backoff retry path: leave alone.

The user-vs-default distinction lives in [handle-job-handler-error.ts:43](../packages/core/src/implementation/handle-job-handler-error.ts#L43) (`isRescheduled` boolean, currently dropped before the adapter call). Plumbing has to thread that through to `rescheduleJob`.

### Why a column, not the existing `last_attempt_error` jsonb

`last_attempt_error` is `jsonb` in the DB but the public contract is `string | null` ([state-adapter.ts:23](../packages/core/src/state-adapter/state-adapter.ts#L23), asserted in [process.test-suite.ts:196](../packages/core/src/suites/process.test-suite.ts#L196)). Repurposing it as `{ message, rescheduled }` would:

1. Be a breaking API change for every consumer of `job.lastAttemptError`, just to add a metric.
2. Couple unrelated concerns (error reporting + retry-progress tracking).
3. Lose history — a single boolean can't represent "user rescheduled three times then went silent."
4. Force expression-indexed jsonb extraction across PG and SQLite for the gauge predicate.

A new int column is +4 bytes per row, indexable with a plain partial, and additive on the public type.

## Indexes

Three additions, all partial over the working set:

```sql
-- Drives incomplete_jobs counts
CREATE INDEX job_metrics_active_idx
  ON job (type_name, status)
  WHERE status != 'completed';

-- Drives incomplete_chains counts and oldest_pending_chain_age
-- (covering: terminal-row lookup via DISTINCT ON chain_id, chain_index DESC)
CREATE INDEX job_metrics_terminal_idx
  ON job (chain_id, chain_index DESC)
  INCLUDE (chain_type_name, status, scheduled_at)
  WHERE status != 'completed';

-- Drives stuck_jobs and stuck_chains
CREATE INDEX job_stuck_idx
  ON job (type_name, chain_type_name)
  WHERE status = 'pending' AND attempts_since_reschedule > 0;
```

Cardinality is bounded by the active working set — i.e. by whatever the cleanup job leaves behind. **Hard dependency: cleanup job must run.** Without it, the active-set assumption breaks down and aggregate cost grows with lifetime job count.

`oldest_pending_job_age_seconds` needs no new index; it's served by the existing `job_acquisition_idx (type_name, scheduled_at) WHERE status='pending'`.

The `stuck_jobs` partial uses `attempts_since_reschedule > 0` (not a baked-in threshold) so the runtime threshold N stays tunable. Cardinality is naturally tiny — only jobs that have failed at least once without user reschedule.

## Queries

```sql
-- oldest_pending_job_age_seconds
SELECT type_name, MIN(scheduled_at)
FROM job
WHERE status = 'pending'
GROUP BY type_name;

-- incomplete_jobs
SELECT type_name, status, COUNT(*)
FROM job
WHERE status != 'completed'
GROUP BY type_name, status;

-- incomplete_chains + oldest_pending_chain_age (single scan)
WITH terminal AS (
  SELECT DISTINCT ON (chain_id)
    chain_id, chain_type_name, status, scheduled_at
  FROM job
  WHERE status != 'completed'
  ORDER BY chain_id, chain_index DESC
)
SELECT
  chain_type_name,
  status,
  COUNT(*) AS incomplete_count,
  MIN(scheduled_at) FILTER (WHERE status = 'pending') AS oldest_pending
FROM terminal
GROUP BY chain_type_name, status;

-- stuck_jobs and stuck_chains (same scan, two group-bys)
SELECT type_name, chain_type_name, COUNT(*)
FROM job
WHERE status = 'pending'
  AND attempts_since_reschedule >= $1
GROUP BY type_name, chain_type_name;
```

The terminal-row insight: for an incomplete chain, the terminal job (`MAX(chain_index)`) is necessarily not `completed` — if it were, with no continuation, the chain would be done. So the scan can drive purely off the active-jobs partition; we never read completed history.

Per-collection cost is dominated by the active-partition scan plus a sort/hash-distinct on `chain_id` for the chain queries — order of milliseconds while the working set is in the tens of thousands. Collection cadence ~60s, so the runner is doing ~one to four index scans per minute, all on partial indexes that don't touch completed rows.

Write amplification: only `job_metrics_active_idx` touches a hot path (every status transition into/out of `completed` updates it), and it's a narrow partial. `job_metrics_terminal_idx` is on the same partition. `job_stuck_idx` updates only on the failure path, which is low-frequency. Worth measuring against `processing-capacity` before committing.

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
  stuck: { threshold: 5 }, // attempts_since_reschedule >= threshold
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

- **Postgres** ([packages/postgres](../packages/postgres)): schema migration adds `attempts_since_reschedule` and the three indexes. `acquireJob` and `rescheduleJob` SQL gain the counter logic. Aggregate queries above are PG-native.
- **SQLite** ([packages/sqlite](../packages/sqlite)): same column + indexes. SQLite supports partial indexes and `INCLUDE` columns differently — `INCLUDE` may need to be replaced with a plain composite index. `DISTINCT ON` isn't supported; use a windowed `ROW_NUMBER() OVER (PARTITION BY chain_id ORDER BY chain_index DESC)` and filter to `rn = 1`.
- **In-process** ([state-adapter.in-process.ts](../packages/core/src/state-adapter/state-adapter.in-process.ts)): track the counter on the in-memory `Job`; aggregate queries become plain JS reductions. No index considerations.

State adapter contract gains:

- New field on `StateJob` / `Job`: `attemptsSinceReschedule: number`.
- `rescheduleJob` parameter set gains `userInitiated: boolean`.
- A new state-adapter method per gauge query, or a single `getMetricsSnapshot()` that returns all aggregates in one call. Single method is preferred — keeps the query layer in the adapter where dialect differences live, and matches the "one DB round-trip per period" goal.

## Migration

Non-breaking:

- `attempts_since_reschedule` adds with `DEFAULT 0` — instant in modern PG, additive in SQLite.
- New indexes are additive.
- `attemptsSinceReschedule` field on `Job`/`StateJob` is additive.

Mildly breaking:

- `rescheduleJob` adapter signature gains `userInitiated`. Bundled adapters update in lockstep; custom adapter implementers (rare) need to re-implement. Treat as adapter-contract minor bump.

The `@queuert/otel-state` package is entirely opt-in — installing it has no effect until the user wires the metrics job into their worker.

## Open questions

1. **Single-runner snapshot distribution.** (a) DB-stored snapshot, (b) per-process scans, or (c) single-runner only. Drives package API.
2. **`stuck` threshold default.** What value of N is the right "stuck" default? Likely workload-dependent; package should expose it but pick a conservative default (e.g. 5).
3. **`getMetricsSnapshot` shape.** One method with all aggregates vs one method per gauge family. Preferred: one method, returns a typed snapshot record.
4. **Should `incomplete_jobs` / `incomplete_chains` skip the `blocked` status?** Blocked work is "incomplete" in the literal sense but isn't lag-relevant — it's waiting on something else by design. Probably keep it but document semantics.
5. **Histogram of `attempt` distribution.** A bucketed `attempt_distribution{type, bucket}` gauge would let users alert on "many jobs at high retry counts" without baking a threshold into the package. Worth a follow-up; not in v1.
