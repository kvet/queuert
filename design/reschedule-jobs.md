# Reschedule jobs

Rename the public `triggerJob` / `triggerJobs` client methods to `rescheduleJob` / `rescheduleJobs` and give them an optional `schedule: { at } | { afterMs }`. Omitting `schedule` means "run now" — the current trigger behavior. Internally, split the single overloaded state-adapter reschedule operation into **two distinct operations** so the client path and the worker-retry path stop fighting over the same columns.

## Problem

Two unrelated needs currently collide on the word "reschedule":

1. **Client-initiated reschedule.** A caller wants to move a `pending` job to a different time — bring a future-scheduled job forward to now (today's `triggerJob`), or push it out to `{ at }` / `{ afterMs }`. No attempt has happened; this is purely "change `scheduled_at`."
2. **Worker retry after a failed attempt.** A handler threw. The processor moves the `running` job back to `pending`, applies backoff, records the attempt error, and releases the lease. This is "an attempt failed, try again later."

Today these are served by two state-adapter methods with mismatched shapes:

- `triggerJobs({ jobIds })` — sets `scheduled_at = now()` where `status = 'pending'`. Client path. No `schedule`.
- `rescheduleJob({ jobId, schedule, error })` — sets `scheduled_at` from `schedule`, `last_attempt_at = now()`, `last_attempt_error = error`, clears the lease, `status = 'pending'`. Worker path.

The naming is backwards from the user-facing vocabulary (`triggerJob` is really a reschedule-to-now; the internal `rescheduleJob` is really a failed-attempt retry), and the public API can only reschedule to _now_, never to a future time.

## Goals

- Public `rescheduleJob` / `rescheduleJobs` that accept an optional `schedule` (`{ at: Date }` | `{ afterMs: number }`), defaulting to now.
- `schedule` semantics identical to `startChain`'s `schedule?` — same `ScheduleOptions` type, same "omitted = now," same past-time clamping.
- Keep the worker retry path correct and separate; never let a client reschedule touch attempt bookkeeping.
- Breaking rename done once, cleanly (major bump). No deprecated aliases.

## Non-goals

- Changing priority, input, or any field other than `scheduled_at` on a client reschedule.
- Rescheduling non-`pending` jobs from the client (a `running` / `completed` / `blocked` job is not client-reschedulable).
- Any DB schema change. All columns already exist.

## The two operations

The core insight (and the source of the struggle below): **a client reschedule and a failed-attempt retry write different columns and start from different statuses. They must not share one statement.**

The job status enum is `'blocked' | 'pending' | 'running' | 'completed'` — there is no `'processing'` status; an in-flight job is `'running'`.

### `rescheduleJobs` — client path (was `triggerJobs`)

```ts
rescheduleJobs: (params: { txCtx?: TTxContext; jobIds: TJobId[]; schedule?: ScheduleOptions }) =>
  Promise<StateJob[]>;
```

- Operates only on `pending` jobs (`WHERE id = ANY(...) AND status = 'pending'`); others are skipped at the adapter level (the client layer rejects them up front — see below).
- Sets **only** `scheduled_at = GREATEST(COALESCE(at, now() + afterMs, now()), now())` — the same clamp expression `createJobs` uses, so a past `{ at }` floors to now.
- Does **not** touch `status` (stays `pending`), `leased_by` / `leased_until`, `attempt`, `last_attempt_at`, or `last_attempt_error`. A reschedule is not an attempt.
- Returns updated rows in input order.

```sql
UPDATE job
SET scheduled_at = GREATEST(COALESCE($at, now() + ($afterMs || ' ms')::interval, now()), now())
WHERE id = ANY($ids) AND status = 'pending'
RETURNING *
```

### `rescheduleFailedJob` — worker path (was `rescheduleJob`)

```ts
rescheduleFailedJob: (params: {
  txCtx?: TTxContext;
  jobId: TJobId;
  schedule: ScheduleOptions; // required — backoff is always computed
  error: string;
}) => Promise<StateJob>;
```

- Operates on the `running` job the worker holds (`WHERE id = ?`), transitioning it `running → pending`.
- Sets `scheduled_at` from the backoff `schedule`, `last_attempt_at = now()`, `last_attempt_error = error`, and clears `leased_by` / `leased_until`.
- Single job: the processor handles one job per attempt, so no batch variant.

```sql
UPDATE job
SET scheduled_at = GREATEST(COALESCE($at, now() + ($afterMs || ' ms')::interval, now()), now()),
    last_attempt_at = now(),
    last_attempt_error = $error,
    leased_by = NULL,
    leased_until = NULL,
    status = 'pending'
WHERE id = $id
RETURNING *
```

Splitting them deletes every conditional that the unified attempt got wrong (see below) and lets each statement read top-to-bottom with one meaning: no `CASE`, no `COALESCE` over an existing column, one status precondition each.

## Public API

```ts
client.rescheduleJob({ id, schedule?, transactionHooks, ...txCtx })   // → ResolvedJob
client.rescheduleJobs({ ids, schedule?, transactionHooks, ...txCtx }) // → ResolvedJob[]
```

- `rescheduleJob` is sugar over `rescheduleJobs([id])`, unwrapping the single result and translating the batch errors to their singular forms.
- `rescheduleJobs` keeps the existing atomic validation: it reads all jobs under an exclusive lock (`getJobs`), and if **any** id is missing or not `pending`, it throws and reschedules nothing.
  - missing → `JobsNotFoundError`
  - not pending → `JobsNotReschedulableError` (renamed from `JobsNotTriggerableError`)
- On success it calls `stateAdapter.rescheduleJobs({ jobIds, schedule })`, buffers a `jobScheduled` notification per job, and emits the `jobRescheduled` observability event (renamed from `jobTriggered`).
- Empty `ids` → `[]`.

`schedule` is optional everywhere; omitting it reschedules to now, matching `startChain`.

## Renames (breaking, single major)

| Before                                                                                     | After                                                                   |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `client.triggerJob`                                                                        | `client.rescheduleJob`                                                  |
| `client.triggerJobs`                                                                       | `client.rescheduleJobs`                                                 |
| state adapter `triggerJobs`                                                                | state adapter `rescheduleJobs`                                          |
| state adapter `rescheduleJob`                                                              | state adapter `rescheduleFailedJob`                                     |
| `JobNotTriggerableError`                                                                   | `JobNotReschedulableError`                                              |
| `JobsNotTriggerableError`                                                                  | `JobsNotReschedulableError`                                             |
| observability `jobTriggered`                                                               | observability `jobRescheduled`                                          |
| dashboard route `POST /jobs/:id/trigger`                                                   | `POST /jobs/:id/reschedule` (optional `schedule` in body)               |
| dashboard handler `handleJobTrigger`, frontend `triggerJob`, `.trigger-btn`, "Trigger now" | `handleJobReschedule`, `rescheduleJob`, `.reschedule-btn`, "Reschedule" |

The worker failed-attempt observability event stays `jobAttemptFailed` (it already carries the `rescheduledSchedule`); only the client-initiated event is renamed.

## Adapters

All three adapters (`in-process`, `postgres`, `sqlite`) implement both operations:

- `rescheduleJobs`: batch `UPDATE ... SET scheduled_at = <clamped> WHERE id IN (...) AND status = 'pending' RETURNING *`, results re-sorted into input order. The `scheduled_at` clamp reuses the per-adapter expression already used by `createJobs` (`GREATEST(COALESCE(...))` in PG, `MAX(COALESCE(...))` in SQLite, `clampToFloor` in-process).
- `rescheduleFailedJob`: unchanged from today's `rescheduleJob` body, renamed.

## Testing

- Rename the state-adapter conformance group `triggerJobs` → `rescheduleJobs`; keep its cases (now-anchoring, future-acquirable, field preservation, input order, empty, skip-missing, skip-non-pending) and add `{ at }`, `{ afterMs }`, and omitted-schedule (= now) cases.
- Rename `rescheduleJob` conformance group → `rescheduleFailedJob` (running→pending, backoff, clamp, error/lease bookkeeping) — unchanged behavior.
- Rename the client suite `trigger-job.test-suite` → `reschedule-job.test-suite`; update method names and add future-reschedule assertions.
- Update logging/otel spec wrappers and the `expect.objectContaining({ name: "rescheduleJob" })` assertions in `process-error-handling.test-suite` to `"rescheduleFailedJob"`.

## Changeset

One `major` entry covering `@queuert/core`, `@queuert/postgres`, `@queuert/sqlite`, `@queuert/dashboard`, and `@queuert/otel`: the client method rename + new `schedule` option, the error-class renames, the dashboard route/label change, and the observability event rename. No DB migration.
