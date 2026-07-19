# Attempt Abort Events Consolidation

## Problem

The attempt lifecycle has a grab-bag of separately-named events that are all reasons an attempt ended abnormally — alongside the true lifecycle events (`started`, `completed`, `failed`, `extended`). The inconsistency exists across three layers:

**Log types** — four separate `TypedLogEntry` variants:

- `job_attempt_taken_by_another_worker` (warn)
- `job_attempt_already_completed` (warn)
- `job_attempt_expired` (warn)
- `job_attempt_reclaimed` (info)

**ObservabilityAdapter** — four separate methods with slightly different data shapes.

**OTEL counters** — four separate counters (`queuert.job.attempt.taken_by_another_worker`, `queuert.job.attempt.already_completed`, `queuert.job.attempt.expired`, `queuert.job.attempt.reclaimed`).

Meanwhile, `JobAbortReason` already models the signal-side discriminator as a union (`taken_by_another_worker | error | not_found | already_completed | worker_stopping`), but the observability layer doesn't use it.

## Taxonomy

These events fall into three distinct categories:

### Hard aborts — `job_attempt_aborted`

The attempt is invalid and processing must stop. These are errors:

- `taken_by_another_worker` — another worker acquired the job
- `not_found` — the job no longer exists
- `already_completed` — another worker already completed it
- `error` — infrastructure failure (e.g. state adapter threw during refetch)

All happen in `refetchJobLocked` and throw. They map to `JobAbortReason` minus `worker_stopping`.

`not_found` and `error` don't currently emit observability events — they just throw. This change would add them.

### Soft abort — `worker_stopping`

The worker is gracefully shutting down. This is a notification, not an error. Already covered by `worker_stopping` / `worker_stopped` log events. No separate attempt-level event needed.

### Housekeeping — `job_attempt_reclaimed`

The worker reclaims a stale attempt so the job can be retried. The attempt is already dead — this is worker-level cleanup, not an in-flight abort. Stays as its own event.

### The expired case — `job_attempt_expired`

The attempt expired but processing continues (the refetch returns the job without throwing). This is a warning, not an error. Stays as its own event.

## Proposed changes

### 1. Split `JobAbortReason`

```ts
type HardJobAbortReason = "taken_by_another_worker" | "not_found" | "already_completed" | "error";

type SoftJobAbortReason = "worker_stopping";

type JobAbortReason = HardJobAbortReason | SoftJobAbortReason;
```

### 2. Narrow the attempt handler signal

The abort signal passed to attempt handlers should only carry `SoftJobAbortReason`. Hard aborts kill the attempt from the outside (via thrown errors) — the handler can't meaningfully react to them. The signal exists for graceful shutdown on `worker_stopping`.

This narrows `TypedAbortSignal<JobAbortReason>` to `TypedAbortSignal<SoftJobAbortReason>` in the handler contract.

### 3. Consolidate observability events

**Replace** `jobAttemptTakenByAnotherWorker`, `jobAttemptAlreadyCompleted` on `ObservabilityAdapter` with a single:

```ts
jobAttemptAborted: (data: JobProcessingData & {
  workerId: string;
  reason: HardJobAbortReason;
}) => void;
```

The reason-specific extra fields (`attemptBy`, `attemptUntil`, `completedBy`) move to the log entry only (via discriminated union on `reason` in the `TypedLogEntry` data). The adapter gets the common fields plus `reason`.

**Add** observability events for `not_found` and `error` aborts, which currently throw without logging.

**Keep** `jobAttemptExpired` and `jobAttemptReclaimed` as separate events (different severity, different lifecycle phase).

### 4. Log type

Replace the three error-level log entry types with one:

```ts
type JobAttemptAbortedLogEntry = LogEntry<
  "job_attempt_aborted",
  "warn",
  string, // dynamic message per reason
  { reason: HardJobAbortReason } & JobProcessingData & WorkerBasicData
>;
```

### 5. OTEL

Replace the three separate counters with one:

```
queuert.job.attempt.aborted  { queuert.abort.reason = "taken_by_another_worker" | ... }
```

The `recordAbort` method on the attempt span already records abort reasons as span events — this aligns the counter with the same pattern.

### 6. Remove `jobAttemptExtended` consideration

`jobAttemptExtended` is a normal lifecycle event (the attempt was successfully extended), not an abort. It stays as-is.

## Files affected

- `packages/core/src/worker/job-process.ts` — split `JobAbortReason`, narrow signal type
- `packages/core/src/observability-adapter/log.ts` — replace 3 log types with 1
- `packages/core/src/observability-adapter/observability-adapter.ts` — replace 3 methods with 1
- `packages/core/src/observability-adapter/observability-helper.ts` — replace 3 helper methods with 1
- `packages/core/src/observability-adapter/observability-adapter.noop.ts` — replace 3 noops with 1
- `packages/core/src/implementation/refetch-job-locked.ts` — update 3 call sites
- `packages/otel/src/observability-adapter/observability-adapter.otel.ts` — replace 3 counters with 1
- `packages/otel/src/specs/observability-adapter.otel.spec-helper.ts` — update metric mapping
- `packages/otel/src/specs/otel.spec.ts` — update test expectations
- `packages/core/src/suites/` — update test expectations
- `docs/src/content/docs/advanced/logging.md` — collapse 3 rows into 1
- `docs/src/content/docs/advanced/otel-metrics.md` — update counter docs

## Breaking changes

- `ObservabilityAdapter` loses 3 methods, gains 1 — custom adapters must update
- `JobAbortReason` splits into `HardJobAbortReason | SoftJobAbortReason` — code narrowing on `JobAbortReason` values still works
- Attempt handler signal narrows from `TypedAbortSignal<JobAbortReason>` to `TypedAbortSignal<SoftJobAbortReason>` — handlers checking `signal.reason === "taken_by_another_worker"` etc. would need to update (unlikely in practice)

## Open questions

- Should the `error` abort carry the underlying error in the adapter data (e.g. `error: unknown` field), or just the reason string?
- Should `not_found` be a warn-level log or error-level? It's arguably more severe than the others since the job vanished entirely.
