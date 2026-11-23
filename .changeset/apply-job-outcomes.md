---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/mysql": major
"@queuert/redis": major
"@queuert/dashboard": patch
---

The client's `applyJobOutcome` and `applyJobOutcomes`, which replace `completeChain` and `rescheduleJob(s)`, apply the same outcomes an attempt handler passes to its own `applyJobOutcome`. Read the job first with a locked read, such as `getChainTailJob({ lock: "exclusive" })`, check its type and status, then apply the outcome.

- `client.applyJobOutcome({ job, output | continueWith | reschedule })` and `client.applyJobOutcomes({ items })` apply any outcome to a blocked, pending or running job, all or nothing, and a running job's attempt is lost; `job` is `{ id, typeName? }` or a job read earlier, and `output` / `continueWith` need its `typeName` narrowed to one job type.
- A job read earlier whose `status` changed since throws the new `JobStatusMismatchError`, or `JobsStatusMismatchError` listing every such job in a batch, instead of being overwritten.
- `completeChain({ id, typeName, handler })` becomes a locked `getChainTailJob` plus `applyJobOutcome` with `output` or `continueWith`; `rescheduleJob({ id })` becomes `applyJobOutcome({ job: { id }, reschedule: { afterMs: 0 } })`, since `reschedule` has no default; `rescheduleJobs({ ids, schedule })` becomes `applyJobOutcomes` with one `{ job: { id }, reschedule }` item per id.
- Removed `JobNotReschedulableError` and `JobsNotReschedulableError`: a `reschedule` of a running job returns it to pending, so a wake that arrives mid-attempt is no longer lost, and a completed job throws `JobAlreadyCompletedError`; to leave running jobs alone, check `status` after a locked read ([#10](https://github.com/kvet/queuert/issues/10)).
- Added `JobsAlreadyCompletedError`. `applyJobOutcomes` throws `JobsTypeMismatchError` listing every job whose `typeName` differs, and `applyJobOutcome` `JobTypeMismatchError`.
- The dashboard's reschedule action reads the job with a lock and reschedules it in the same transaction, and answers 409 for a running or completed job.
