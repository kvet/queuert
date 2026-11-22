---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/mysql": major
"@queuert/redis": major
"@queuert/otel": minor
"@queuert/dashboard": minor
---

Jobs count the attempts in a row that failed and keep the reason they were last rescheduled next to the last attempt's error, and backoff follows that count instead of the attempt number. A job that rescheduled itself twenty times and then failed backs off as from its first failure, and an attempt reclaimed from a worker that lost its lease or stopped backs off too instead of running again at once. The new columns ship in the same breaking `002_schema_v2` migration as the chain `blocking` flag; upgrade every process before or right after migrating.

- `Job` gains `consecutiveFailures`; any outcome other than a failure resets it to 0, including `complete({ reschedule })` and a client `applyJobOutcome` / `applyJobOutcomes` with `reschedule`.
- `Job` gains `lastRescheduleReason`, the reason a handler or client gave for the last reschedule, or `null`.
- `Job.lastAttemptError` is `null` after an attempt that ended without failing, and a client reschedule leaves it in place.
- `complete({ reschedule, reason })` and a client `applyJobOutcome` / `applyJobOutcomes` with `reschedule` accept an optional reason, truncated to 10,000 characters; `reason` without `reschedule` is a type error.
- Backoff uses `consecutiveFailures` instead of `attempt`; reclaimed attempts back off with the processor's `backoffConfig`, or the reclaiming worker's default when it does not run that job type.
- State adapters: `StateJobInfo` gains `consecutiveFailures` and `lastRescheduleReason`, and `rescheduleJobs` entries accept `reason`, resetting the count on every reschedule that is not a failure.
- PostgreSQL, SQLite and MySQL store `last_attempt_error` as plain text and add `last_reschedule_reason` and `consecutive_failures`, set to 1 for jobs that hold an error; Redis adds the count to stored jobs the same way.
- `jobRescheduled` and the `job_rescheduled` log entry carry `consecutiveFailures` and the `reason`.
- `@queuert/otel` adds `queuert.reschedule.reason` to the attempt span.
- The dashboard shows how many times in a row a job failed and the reason it was rescheduled.
