# Reschedule reason and failure-streak backoff

Persist why the last attempt rescheduled and how many attempts in a row have failed, so backoff restarts after a deliberate reschedule, the dashboard can tell a failure from a requested reschedule, and a later stuck signal has a column to read.

## Problem

`finish({ reschedule })` shipped as a non-error outcome, but storage still only knows about errors:

- **Backoff counts the wrong thing.** `handleJobHandlerError` computes the delay from `attempt`, and `startJobAttempt` bumps `attempt` on every acquire, including attempts that ended in `finish({ reschedule })`. A job that long-polls twenty times and then fails backs off as if it had failed twenty times. The design that introduced `finish({ reschedule })` accepted this ("document it, don't design around it"); it is the reason this design exists.
- **The last attempt's outcome is half-recorded.** A failure writes `last_attempt_error`; a handler reschedule writes `last_attempt_error = NULL` and nothing else. The dashboard (`jobPhase`) can show "rescheduled after error" but has no way to show why a handler asked to come back later, and apps log "Rescheduling job" by hand to get that.
- **Nothing counts failures in a row.** The stuck gauges in `design/state-gauges.md` need "this job has failed N times without making progress". `attempt` cannot answer it, for the same reason it cannot drive backoff.

## History

An earlier state-snapshot-metrics design added `attempts_since_reschedule` (`++` on acquire, reset on user reschedule). The job-model redesign reshaped it (first into a `last_user_reschedule_attempt` marker, then back into `attempts_since_user_reschedule`, also reset on unblock) and then removed it together with the `userInitiated` adapter flag, leaving stuck detection blocked. Both docs were later deleted; see `git show 9ea7353b:design/state-snapshot-metrics.md` and `git show 6cd86e46:design/job-model.md`. This design brings the counter back with failure semantics instead of acquire semantics and gives it a second consumer, backoff.

## Schema

Two columns on `job`, next to `last_attempt_error` / `last_attempt_at`:

```
failure_streak          -- int NOT NULL DEFAULT 0; attempts in a row that ended in failure
last_reschedule_reason  -- text NULL; reason passed to finish({ reschedule }) by the last attempt
```

Both are written only when an attempt ends — the same `status = 'running'` branch of `rescheduleJobs` that writes `last_attempt_at` / `last_attempt_error` today:

| Attempt ends with                   | `failure_streak`          | `last_attempt_error` | `last_reschedule_reason` |
| ----------------------------------- | ------------------------- | -------------------- | ------------------------ |
| failure (handler threw)             | `+ 1`                     | error                | `NULL`                   |
| `finish({ reschedule, reason? })`   | `0`                       | `NULL`               | reason or `NULL`         |
| `finish({ output / continueWith })` | unchanged (job completes) | unchanged            | unchanged                |

Not touched by `client.rescheduleJob(s)` on a pending job (a reschedule from outside is not an attempt, matching how it already leaves `last_attempt_*` alone), by blocking or unblocking, or by `startJobAttempt`.

Incrementing on failure rather than on acquire (the old design) means a running attempt does not count before it has failed, nothing has to be reset on unblock, and the value at failure time is exactly the backoff exponent.

The last attempt's outcome is derivable without a stored enum: `failure_streak > 0` means it failed; `last_attempt_at IS NOT NULL AND failure_streak = 0` on a pending job means the handler rescheduled, with `last_reschedule_reason` as the optional message.

### Why not reuse `last_attempt_error`

The reasoning from the original metrics design still holds: `lastAttemptError` is public as `string | null`, so storing `{ message, rescheduled }` in it breaks every consumer; it couples error reporting with progress tracking; a single value cannot hold a streak; and gauge predicates would need jsonb expression indexes on PG and SQLite.

## API

- `finish({ reschedule: ScheduleOptions, reason?: string })`. `reason` is a sibling of `reschedule`, not part of `ScheduleOptions` (shared with `createChain` and `client.rescheduleJob(s)`), and is only accepted alongside `reschedule`.
- `Job` gains `failureStreak: number` and `lastRescheduleReason: string | null`.
- State adapter: `rescheduleJobs` job entries gain `reason?: string`. The adapter keeps using the presence of `error` to tell a failure from a handler reschedule, so no `userInitiated` flag comes back.

## Backoff

`handleJobHandlerError` computes `calculateBackoffMs(stateJob.failureStreak + 1, backoffConfig)` instead of `calculateBackoffMs(stateJob.attempt, …)`. The first failure after any handler reschedule waits `initialDelayMs` again. `attempt` keeps its meaning (every attempt that happened) and keeps driving nothing else.

## Observability

- Attempt span for `finish({ reschedule })`: stays `ok` (decided when the outcome shipped), but now sets `queuert.rescheduled_at` / `queuert.rescheduled_after_ms` like failed attempts do, plus `queuert.reschedule.reason` when given.
- `job_rescheduled` log entry and `jobRescheduled` adapter data gain `reason?: string` and `failureStreak: number`.
- The reason never becomes a metric attribute — it is free text.

## Dashboard

`jobPhase` uses `failureStreak` instead of `lastAttemptError != null` for "rescheduled after error", and gains a rescheduled-by-handler state that shows `lastRescheduleReason`. The job item shows the streak next to the attempt count when it is above zero.

## Migration

PG: `ADD COLUMN failure_streak integer NOT NULL DEFAULT 0` (metadata-only) and `ADD COLUMN last_reschedule_reason text`. SQLite: the same as two `ALTER TABLE … ADD COLUMN`. In-process: field defaults.

No backfill. Existing failing jobs start their streak at 0, so their next backoff is short once — acceptable, and the honest value is not recoverable (`attempt` mixes in handler reschedules).

## Interaction with worker liveness

`design/worker-liveness.md` rewrites released attempts as failures (`last_attempt_error = 'Worker stopped unexpectedly'`, no backoff). Those releases should also `failure_streak + 1`: a job that keeps killing its worker is the classic stuck job. Today's `reclaimExpiredJobAttempt` records the release as a failure (`last_attempt_error` holds a serialized `JobAttemptExpiredError`) but does not bump any streak.

## Open questions

1. **Names.** `failure_streak` and `last_reschedule_reason` are new domain words; add the chosen ones to the vocabulary in `code-style.md`.
2. **Reason on `client.rescheduleJob(s)`.** Useful for "retry now" from the dashboard, but that path is not an attempt and does not touch `last_*` columns. Lean: not in v1.
3. **A `source` discriminator on `jobRescheduled`** (`failure` / `handler` / `client`) for the `queuert.job.rescheduled` counter. Cheap, low-cardinality, and closes the open question left by the `finish({ reschedule })` design. Lean: include.
4. **Length of `reason`.** Document "short"; do not truncate silently.
