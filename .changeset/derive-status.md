---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/dashboard": major
---

Job and chain status are now derived at read time from structural columns instead of being stored, and the status vocabulary has been expanded. Job status becomes a six-value set — `blocked`, `scheduled`, `ready`, `running`, `succeeded`, `completed` — where the old `pending` splits into `ready`/`scheduled` and the old `completed` splits into terminal `completed` (carries `output`) and `succeeded` (a `continueWith` handoff that carries `continuedToJobId`). Chain status becomes `open` | `closed`. The stored `status` column (and the Postgres `job_status` enum / SQLite `CHECK`) is dropped via a forward-only migration; acquisition, lease-reaping, and listing now run on structural predicates, and a new `job_chain_tail_idx` partial index serves chain-frontier lookups.

- **Breaking:** `JobStatus` is now `"blocked" | "scheduled" | "ready" | "running" | "succeeded" | "completed"`; the `Job` discriminated union splits `completed` into `completed` (terminal, `output`) and `succeeded` (handoff, `continuedToJobId`).
- **Breaking:** `ChainStatus` is now `"open" | "closed"`; `awaitChain`/`completeChain` resolve to a `closed` chain.
- **Breaking:** the deduplication `scope` option `"incomplete"` is renamed to `"open"`.
- **Breaking (state adapter):** `StateJob` no longer has a `status` field; instead it carries a clock-relative `scheduledInFuture` flag that each adapter evaluates at read time against its own clock (the database's `now()` for the SQL adapters), so a `StateJob` is a read snapshot rather than a cacheable entity. `listJobs` filters via structural `statePredicates` and `listChains` via a `closed` boolean; `triggerJobs` returns full jobs in `notTriggerable`; `acquireJob` now takes `workerId`/`leaseDurationMs` and sets the lease at acquisition time.
- The Postgres and SQLite schemas drop the stored `status` column/enum/CHECK and rebuild the acquisition, lease, and chain-frontier indexes on structural predicates.
- `blocked` is derived from a denormalized `has_open_blockers` boolean (surfaced as `hasOpenBlockers` on `StateJob`): Postgres and SQLite gain a stored `has_open_blockers` column (backfilled `true` for rows that were `blocked`), `addJobsBlockers` sets it when adding blockers, and `unblockJobs` clears it once a job's last blocker chain resolves.
- A job that triggers must now be `ready` or `scheduled` (`JobNotTriggerableError` message updated accordingly).
