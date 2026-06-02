---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/dashboard": major
"@queuert/otel": major
---

Rename the client `triggerJob` / `triggerJobs` methods to `rescheduleJob` / `rescheduleJobs` and give them an optional `schedule` so a pending job can be moved to any time, not just brought forward to now. No DB migration.

- `client.triggerJob` → `client.rescheduleJob` and `client.triggerJobs` → `client.rescheduleJobs`. Both now accept an optional `schedule: { at: Date } | { afterMs: number }`; omitting it reschedules to now (the previous behavior) and a past time clamps to now, matching `startChain`. Only `pending` jobs are reschedulable, and batch validation stays atomic.
- The error classes `JobNotTriggerableError` / `JobsNotTriggerableError` are renamed to `JobNotReschedulableError` / `JobsNotReschedulableError`.
- The observability event `jobTriggered` is renamed to `jobRescheduled`; the OpenTelemetry counter `queuert.job.triggered` becomes `queuert.job.rescheduled` and the structured log entry `job_triggered` becomes `job_rescheduled`.
- `jobRescheduled` is now also emitted by the worker retry path (after a failed attempt is rescheduled), not just by client reschedules, making it the single signal for "a job's `scheduledAt` changed." It carries the resolved `scheduledAt` — the value actually stored. Correspondingly, `jobAttemptFailed` is now a pure failure event — the previous `rescheduledAt` / `rescheduledAfterMs` fields are removed from it (and from the `job_attempt_failed` log entry); observability-adapter authors should read `scheduledAt` from `jobRescheduled` instead. The attempt span still annotates the retry time.
- Both `jobCreated` and `jobRescheduled` now report the resolved `scheduledAt` (the absolute value stored after clamping a past time to now) and nothing else schedule-related. `jobCreated` previously echoed the requested `schedule` input — an optional `scheduledAt` plus a relative `scheduleAfterMs` — which could disagree with what was actually stored; `scheduledAt` is now always present and authoritative, and the redundant `scheduleAfterMs` field is dropped from both events and their `job_created` / `job_rescheduled` log entries.
- The dashboard route `POST /jobs/:id/trigger` becomes `POST /jobs/:id/reschedule`, and the "Trigger now" button is now "Reschedule".
- For custom state-adapter authors: the SPI method `triggerJobs` is renamed to `rescheduleJobs` and gains the optional `schedule` param. The single worker-retry method `rescheduleJob` is replaced by two composable operations run together in one transaction — `abandonJob` (release a failed attempt back to `pending`: record the attempt error and clear the lease, without touching `scheduled_at`) followed by `rescheduleJobs` to set the backoff time. A client reschedule and a failed-attempt retry now share one `scheduled_at` primitive and never collide on attempt bookkeeping.
