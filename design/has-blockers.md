# Decouple `blocked` from `JobStatus`

## Problem

`JobStatus = "blocked" | "pending" | "running" | "completed"` mixes two orthogonal axes:

- **Lifecycle** — what the worker is doing with the job: `pending → running → completed`. Monotonic, owned by the worker.
- **Readiness** — is the job acquirable right now? Today depends on three independent facts: scheduled time has arrived, concurrency budget available, no incomplete blockers.

Two of the three readiness gates (time, concurrency) are acquire-time predicates. The third (blockers) is denormalized into `status`. That asymmetry is the architectural smell. Consequences:

- `JobStatus` is the only readiness gate that's also a lifecycle value. The enum lies about what it represents.
- `addJobsBlockers` mutates `status`; `unblockJobs` exists solely to flip it back. Two write paths must keep `status` and `job_blocker` in agreement, or jobs get stuck.
- Public API conflates "the worker hasn't picked it up yet" (`pending`) with "structurally not yet eligible" (`blocked`). Users reasoning about lifecycle have to special-case `blocked`.

## Why not drop the denormalization entirely

Considered: remove `blocked` from `JobStatus`, gate acquisition with `NOT EXISTS (SELECT 1 FROM job_blocker … WHERE incomplete)`. This is the cleanest model — `job_blocker` becomes the sole source of truth — but the math doesn't survive chain-heavy workloads. Benchmarked on Postgres 18 at 90k blocked / 10k pending:

| shape          | `status='blocked'` (today) | `NOT EXISTS` (no denormalization) |
| -------------- | -------------------------- | --------------------------------- |
| random         | **0.01 ms**                | **254 ms**                        |
| blocked-front  | 0.01 ms                    | 202 ms                            |
| pending-front  | 0.01 ms                    | 193 ms                            |

A ~15,000–25,000× regression in server execution time. The plan explains it: when no acquirable row exists (or it's far down the queue), Postgres' anti-join walks the full pending index, probing `job_blocker` for each row — **800k buffer hits per acquire** vs 3 for the current design. The planner doesn't short-circuit, so even *random* interleaving — not just the worst-case blocked-front shape — degrades catastrophically. At 1M jobs the cost extrapolates to seconds per acquire.

No partial-index trick saves this: both SQLite and Postgres require partial-index predicates to be deterministic on the indexed row, so `WHERE NOT EXISTS (…)` is not allowed.

The denormalization has to stay. The only architectural question is **where it lives**.

## Solution: `has_blockers` column

Add a boolean column to `job`. Drop `"blocked"` from `JobStatus`. The acquisition predicate becomes `status = 'pending' AND has_blockers = false`.

```sql
ALTER TABLE job ADD COLUMN has_blockers boolean NOT NULL DEFAULT false;
```

`JobStatus` becomes pure lifecycle: `"pending" | "running" | "completed"`.

### Index changes

- **SQLite** acquisition index becomes `WHERE status = 'pending' AND has_blockers = false`. Hot index size unchanged from today (only acquirable rows).
- **Postgres** gains the same partial index (it doesn't have one today; this is a small win).

### Maintenance

- `addJobsBlockers` (creation-time) / `addJobBlocker` (runtime, on existing pending job): set `has_blockers = true` when at least one incomplete blocker is added. Conditional update — skip the write if already `true`. Stops mutating `status`.
- `unblockJobs`: same readiness detection as today (`bool_and(status = 'completed')` per dependent over its blocker chains); on the boundary, set `has_blockers = false` instead of `status = 'pending'`.
- `createJobs`: set `has_blockers = true` when the job is created with incomplete blockers; default `false`.

Writes to `job.has_blockers` are bounded to boundary events (first blocker added, last blocker cleared) — typically two per dependent over its full lifecycle, regardless of blocker count.

## Why not a counter (`remaining_blockers_count`)

The 1M-blocker scaling work in [add-job-blocker.md](add-job-blocker.md) proposes a `remaining_blockers_count integer` column to make `unblockJobs` O(1) per completion. The counter encodes "is blocked" as `count > 0`, so superficially it could replace `has_blockers`. It shouldn't, because the write profile is wrong:

- **Counter:** every blocker-chain completion writes to every dependent's `job` row to decrement. At 1M blockers per dependent, that's **1M row versions on a single `job` row** across its lifecycle. Postgres MVCC turns that into 1M dead tuples plus index-entry churn on the system's hottest table.
- **Boolean:** flips only at boundaries — `false → true` when the first incomplete blocker is added, `true → false` when the last clears. **~2 writes per dependent over its lifecycle**, regardless of blocker count. No hot-row dead-tuple accumulation on `job`.

For this design, we keep `unblockJobs`'s existing detection logic (`bool_and(status = 'completed')` over a job's blocker chains) and simply flip `has_blockers` at the boundary instead of mutating `status`. The 1M-blocker scaling problem is left to [add-job-blocker.md](add-job-blocker.md) — but the counter is the wrong tool for it; that design should be revisited (a different denormalization, e.g., row-deletion-on-chain-completion, would solve scaling without the vacuum problem).

## Interaction with `addJobBlocker` (runtime addition)

[add-job-blocker.md](add-job-blocker.md) introduces a client method that adds blockers to an *existing* job at runtime (vs. only at job creation today). With `has_blockers` decoupled from `status`, the interaction is straightforward and strictly simpler than today's status flip:

- Allowed jobs: `pending` only (today's design also allows `blocked`; under this design `blocked` no longer exists, but a `pending` job with `has_blockers = true` is the equivalent state and is allowed).
- Operation, in one transaction:
  1. Insert `job_blocker` rows.
  2. Determine how many of the added blocker chains are currently incomplete (existing logic).
  3. If at least one is incomplete and `has_blockers` is currently `false`, set `has_blockers = true`. Otherwise no `job` write — the column is already correct.
- No status mutation. `pending` stays `pending`; the row simply becomes non-acquirable via the `has_blockers = false` predicate on the partial index.
- Race with `unblockJobs` on the same job: today, `addJobBlocker` flipping `pending → blocked` competes with `unblockJobs` flipping `blocked → pending`. Under this design both operations write the same boolean column with clear ordering — last write wins, which is the semantics you want (whether the dependent ends `has_blockers = true` or `false` is determined by the actual current state of `job_blocker`, recomputed by whichever operation commits last).

This also removes a subtle hazard in the current design: today, if `addJobBlocker` and `unblockJobs` interleave, the `status` enum can briefly disagree with the `job_blocker` table. Under this design, `status` no longer carries readiness, so it can't be wrong — the worst case is `has_blockers` lagging by one transaction, which the next call to either operation corrects.

## Public API impact

Breaking change. `JobStatus` no longer includes `"blocked"`.

- `Job.status` no longer surfaces `"blocked"`. Replaced by deriving from the new column (or `remaining_blockers_count > 0`) — either kept internal, or surfaced as a derived field on the public `Job` shape (e.g., `job.hasBlockers: boolean`). Prefer keeping it internal when possible; users who need the list already have `listBlockedJobs`.
- `listJobs({ status: 'blocked' })` callers must migrate to `listBlockedJobs` or a new filter on the readiness column.
- Changeset: `major` for `@queuert/core`, `@queuert/postgres`, `@queuert/sqlite`.

## State Adapter Changes

### Type changes

```typescript
// Before
type StateJobStatus = "blocked" | "pending" | "running" | "completed";

// After
type StateJobStatus = "pending" | "running" | "completed";

// StateJob gains:
hasBlockers: boolean;  // or: remainingBlockersCount, if the counter design lands
```

### Modified queries

- `acquireJobSql`: add `AND has_blockers = false`.
- `getNextJobAvailableInMsSql`: same.
- `addJobsBlockersSql`: set `has_blockers = true` (conditional on currently `false`) instead of mutating `status`.
- `unblockJobsSql`: same readiness detection as today; flip `has_blockers = false` instead of `status = 'pending'`. No other behavioral change.
- `listBlockedJobsSql`: filter by `has_blockers = true` instead of `status = 'blocked'`. Already queries `job_blocker`; predicate change only.
- All call sites that match `status = 'blocked'` migrate to `has_blockers`.

### In-process adapter

- Drop the `"blocked"` branch from the status state machine.
- Track `hasBlockers` per job in the in-memory map.
- Mirror SQL adapters: flip `hasBlockers` at the same boundaries.

## Migration

```sql
-- Add column
ALTER TABLE job ADD COLUMN has_blockers boolean NOT NULL DEFAULT false;

-- Backfill from existing 'blocked' status
UPDATE job SET has_blockers = true WHERE status = 'blocked';

-- Collapse 'blocked' jobs back to 'pending' lifecycle
-- (scheduled_at is unchanged; readiness is now gated by has_blockers)
UPDATE job SET status = 'pending' WHERE status = 'blocked';
```

## Conformance Tests

Existing cases under `packages/core/src/conformance/state-adapter-cases/` exercise the right behaviors; the assertions change shape but not coverage:

- `add-jobs-blockers.ts`: assert `hasBlockers` flips, not `status`.
- `unblock-jobs.ts`: assert lifecycle stays `pending` throughout; only `hasBlockers` toggles.
- `acquire-job.ts`: add a case that pending-with-blockers is not acquired (today this is implied by the type-level absence of `blocked` from acquire's predicate; with the new model it becomes a substantive runtime check).
- `list-blocked-jobs.ts`: predicate-only change.

## Open Questions

1. **Surface `hasBlockers` on the public `Job` shape, or keep internal?** Internal is cleaner — `listBlockedJobs` is the documented way to find blocked jobs. Surfacing it invites users to filter on it directly, which is fine but ties the public API to the denormalization choice.
2. **Migration ordering.** `UPDATE … WHERE status = 'blocked'` must run after schema add but before any worker starts polling with the new predicate. Standard migration sequencing, but worth calling out.
3. **Coordinate with `add-job-blocker.md`.** That design's `remaining_blockers_count` counter has the vacuum problem described above and should be revisited regardless of this work. This design lands the architectural cleanup independently; the 1M-blocker scaling story still needs its own answer.

## Implementation Order

1. Schema migration: add `has_blockers` (postgres + sqlite). Update partial indexes.
2. Backfill from `status = 'blocked'`, then collapse those rows back to `status = 'pending'`.
3. Update `addJobsBlockersSql`, `unblockJobsSql`, `acquireJobSql`, `getNextJobAvailableInMsSql`, `listBlockedJobsSql` to read/write `has_blockers` instead of `status = 'blocked'`. Detection logic in `unblockJobs` is unchanged.
4. Update in-process adapter.
5. Drop `"blocked"` from `JobStatus` (core types + exports).
6. Migrate conformance tests + public API consumers.
7. Changeset (`major`), release notes with migration guidance.
