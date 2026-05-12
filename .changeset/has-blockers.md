---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

Decouple blocker-readiness from `JobStatus`. The status enum becomes pure lifecycle — `"pending" | "running" | "completed"` — and `"blocked"` is removed. A pending job that's waiting on incomplete blocker chains is now still `status: "pending"`; whether it's acquirable is denormalized into a new per-row `has_blockers` boolean, internal to each adapter. Acquisition (`acquireJob`, `getNextJobAvailableInMs`) and `triggerJob` gate on `has_blockers = false`; `addJobsBlockers` flips the flag to true when at least one blocker chain is incomplete; `unblockJobs` flips it back to false at the same boundary it previously used to move `status` back to `"pending"`. The public `Job` shape loses its `blocked` variant — use `client.listBlockedJobs({ chainId })` to find dependents of a given blocker chain. The `Postgres` `job_status` enum drops the `'blocked'` value (the migration recreates dependent partial indexes), and SQLite gains an `INTEGER`-backed `has_blockers` column.

Rolling-deploy caveat: the schema migration backfills `has_blockers = true` for existing `status = 'blocked'` rows and collapses them to `'pending'` before the enum is recreated. Mid-rollout, an old worker is forward-safe — it'll write `has_blockers = false` (the column default) and `status = 'pending'` (its only writable lifecycle value), but it can't set jobs blocked. Hold off blocker-mutating traffic until the rollout completes, or run the backfill again afterward to fix up any chains an old worker created with incomplete blockers.
