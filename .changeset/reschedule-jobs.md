---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/dashboard": major
"@queuert/otel": major
---

Rename the client `triggerJob` / `triggerJobs` methods to `rescheduleJob` / `rescheduleJobs`, add an optional `schedule` param, introduce strict batch errors, and make breaking provider changes. No DB migration.

- `client.triggerJob` → `client.rescheduleJob` and `client.triggerJobs` → `client.rescheduleJobs`. Both now accept an optional `schedule: { at: Date } | { afterMs: number }`; omitting it reschedules to now (the previous behavior) and a past time clamps to now, matching `startChain`. Only `pending` jobs are reschedulable, and batch validation stays atomic.
- The error classes `JobNotTriggerableError` / `JobsNotTriggerableError` are renamed to `JobNotReschedulableError` / `JobsNotReschedulableError`. New batch error variants `JobsNotFoundError` and `JobsNotReschedulableError` are thrown by `client.rescheduleJobs` when one or more inputs are missing or not pending. The `status` property has been removed from `JobNotReschedulableError`; the batch variant exposes offending ids via `jobIds`.
- The observability event `jobTriggered` is renamed to `jobRescheduled`; the OpenTelemetry counter `queuert.job.triggered` becomes `queuert.job.rescheduled` and the structured log entry `job_triggered` becomes `job_rescheduled`.
- `jobRescheduled` is now also emitted by the worker retry path (after a failed attempt is rescheduled), not just by client reschedules, making it the single signal for "a job's `scheduledAt` changed." It carries the resolved `scheduledAt` — the value actually stored. Correspondingly, `jobAttemptFailed` is now a pure failure event — the previous `rescheduledAt` / `rescheduledAfterMs` fields are removed from it (and from the `job_attempt_failed` log entry); observability-adapter authors should read `scheduledAt` from `jobRescheduled` instead.
- Both `jobCreated` and `jobRescheduled` now report the resolved `scheduledAt` (the absolute value stored after clamping a past time to now) and nothing else schedule-related. The redundant `scheduleAfterMs` field is dropped from both events and their log entries.
- `StateProvider` (both `@queuert/postgres` and `@queuert/sqlite`) gains a required `transactionConcurrency: "concurrent" | "serialized"` field that reports whether two `withTransaction` callbacks can run in flight at once. Custom providers must declare it — use `"concurrent"` for connection-pool backed providers (pg, postgres-js, Drizzle, Kysely, Prisma over pg) and `"serialized"` for single-handle SQLite drivers.
