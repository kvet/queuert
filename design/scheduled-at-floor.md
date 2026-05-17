# `scheduled_at` as eligibility floor (fair unblock ordering)

> **Builds on**: [job-model.md](job-model.md).

## The invariant

`scheduled_at` is the **earliest moment a job is eligible to run** — the floor across every "don't run before X" gate that applies to the current attempt.

Two gates produce eligibility constraints:

1. **Time gate** — the user-supplied `scheduledAt`, or `now()` at creation if none was supplied. This is what's _initially_ stored.
2. **Blocker gate** — set of blocker chains; the job can't run until they all close. The moment this gate clears is `now()` at the time of the last blocker's `unblockJobs` write.

`scheduled_at` should reflect the floor across both: the actual earliest moment the job is eligible. Acquisition (`ORDER BY scheduled_at ASC`) then orders by "next-eligible first," which is the fair ordering.

## Today's bug

`unblockJobs` doesn't write `scheduled_at`. A job created with `scheduled_at = T_create` and blocked the entire time keeps `scheduled_at = T_create` after blockers clear — even though it wasn't actually eligible until T_unblock (much later). The column lies about when the job became ready, and acquisition reads the lie:

```
Job A: scheduled_at = 09:00:00, no blockers, ready since 09:00:00.
Job B: scheduled_at = 09:00:01, no blockers, ready since 09:00:01.
Job C: scheduled_at = 09:00:00, blocked, blockers clear at 10:00:00.

At 10:00:01, acquisition order (ASC): C (09:00:00), A (09:00:00), B (09:00:01).
                                       ↑ jumps to the front despite being ready last.
```

Symptomatically: blocked-since-creation jobs "jump in front of everything else once unblocked," from the TODO entry in [TODO.md](../TODO.md). The deeper issue is that `scheduled_at` isn't honest about eligibility.

## The fix

`unblockJobs` raises `scheduled_at` to the actual eligibility moment:

```sql
UPDATE job
SET has_open_blockers = false,
    scheduled_at = GREATEST(scheduled_at, now())
WHERE … AND has_open_blockers = true;
```

SQLite equivalent: `MAX(scheduled_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))` (or whatever timestamp form the adapter uses).

Behavior across scenarios:

| Scenario                                                                | Without clamp                     | With `GREATEST(scheduled_at, now())` |
| ----------------------------------------------------------------------- | --------------------------------- | ------------------------------------ |
| `scheduled_at = T_create`, blocked since T_create, unblocks at T_now    | Lies (T_create), jumps the queue  | Honest (T_now), joins FIFO           |
| User-set future `scheduled_at = now() + 1h`, blockers clear before then | Preserved (intended delay holds)  | Preserved (max picks the future)     |
| `scheduled_at` slightly in the past, blockers clear right after         | Lies (slightly), small unfairness | Honest (T_now)                       |

The clamp moves `scheduled_at` **forward or holds it**; it never moves backward.

## When `scheduled_at` moves

| Operation                                                          | Effect on `scheduled_at`                                                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `createJobs` (any kind)                                            | Sets initial floor: user-supplied `scheduledAt`, or `now()` at creation                        |
| `unblockJobs`                                                      | `GREATEST(scheduled_at, now())` — raises or holds (this design)                                |
| `rescheduleJob`                                                    | Resets the floor for the _next attempt_ (user-supplied or backoff-derived); new attempt's gate |
| `triggerJobs`                                                      | Resets to `now()` — explicit "run as soon as possible"                                         |
| `acquireJob` / `completeJob` / `addJobsBlockers` / `addJobBlocker` | No write                                                                                       |

`unblockJobs` is the only operation that _raises-or-holds_ — `rescheduleJob` and `triggerJobs` are explicit re-anchors of the attempt's eligibility, expected to potentially move the floor backward (e.g., trigger sets it to now even if it was in the future).

### Why not `addJobBlocker` (runtime blocker addition)

[design/dynamic-blockers.md](dynamic-blockers.md) (when it lands) adds blockers to a `ready`-status row at runtime. Should that write `scheduled_at`?

No. When a blocker is added, the future eligibility moment is unknown — it's whenever the new blocker chain closes, which can't be predicted at the time of the write. The `scheduled_at` floor remains the time gate; the blocker gate is tracked separately by `has_open_blockers`. When the blocker eventually clears, `unblockJobs` runs and clamps `scheduled_at` forward — same code path as the creation-time blocker case.

This is symmetric with what `has_open_blockers` already represents: a binary "is the blocker gate currently closed?" The eligibility-floor `scheduled_at` is the _time_ gate; `has_open_blockers` is the _dependency_ gate; both must clear for acquisition. The fix in this design is just making `scheduled_at` honest at the moment the dependency gate clears.

## Downstream effects

Making `scheduled_at` the honest eligibility floor improves several downstream signals at no extra cost:

- **Dashboard.** "Scheduled for X" on a blocked job is honest both before and after unblock. Today, the displayed `scheduledAt` silently becomes stale once a job sits in `blocked` for a while.
- **State-snapshot metrics** ([state-snapshot-metrics.md](state-snapshot-metrics.md)). `oldest_ready_job_age_seconds = now() - MIN(scheduled_at)` over ready jobs becomes the _actual_ lag — not "lag since the job _would have been_ ready if blockers had never existed." Operators alerting on lag get truthful numbers.
- **Wall-clock aging** ([job-priority.md](job-priority.md) v2). If aging ever lands, the aging signal is `now() - scheduled_at`. With the clamp, that measures real wait-since-eligible, not wait-since-creation-of-a-once-blocked-job. The aging formula doesn't need to special-case blocked-then-unblocked rows.
- **Fairness with retry backoff.** A job that fails and reschedules to `scheduled_at = now() + backoff_ms` sorts behind ready jobs (correct). Today's bug makes a _blocked-since-creation_ job sort _ahead_ of fresh retries — a worse outcome than the retry's own delay was meant to enforce.

## Migration

Pure SQL change. No schema migration, no backfill.

- **Postgres**: one-line edit to `unblockJobsSql` — `SET scheduled_at = GREATEST(scheduled_at, now())` added next to the `has_open_blockers = false` write.
- **SQLite**: equivalent — `MAX(scheduled_at, …)` against the adapter's timestamp form.
- **In-process**: equivalent in JS — `Math.max(job.scheduledAt.getTime(), Date.now())` before storing.

Conformance test: add one case to `unblock-jobs.ts` that creates a job with `scheduledAt = T_past`, adds a blocker, completes the blocker at T_unblock > T_past, asserts the job's `scheduledAt` is clamped to T_unblock and that it doesn't acquire ahead of other ready jobs scheduled between T_past and T_unblock.

## What this doesn't address

- **Sustained-arrival fairness** between continually-blocked and continually-ready workloads — that's a wall-clock aging concern, deferred to [job-priority.md](job-priority.md) v2. This design just makes the _input_ to any future aging signal honest.
- **Chain-progress vs. job-FIFO interaction** — unblock fairness orders jobs across the queue; it doesn't say anything about whether unblocked continuations should preempt fresh chains. The TODO entry's "fairness vs. chain progress vs. priority interaction" question remains open, but is orthogonal to the eligibility-floor fix.
