---
"queuert": minor
"@queuert/postgres": minor
"@queuert/sqlite": minor
---

`scheduled_at` is now the honest "earliest moment eligible" floor: state adapters clamp it to `MAX(requested, now())` on `createJobs`, `rescheduleJob`, and `unblockJobs`. Previously, jobs with a user-supplied past `scheduled_at` (or blocked-since-creation jobs whose original `scheduled_at` went stale while they waited) would jump to the front of the acquisition queue ahead of jobs that genuinely became ready earlier. Behavior change for `unblockJobs`: it previously reset `scheduled_at` to `now()` unconditionally; it now preserves a future `scheduled_at` set at job creation (the clamp picks the later of the two), so an intended future delay survives a blocker round-trip. `triggerJobs` continues to reset to `now()` as an explicit re-anchor. Applies to the PostgreSQL, SQLite, and in-process adapters; no schema migration or backfill required.
