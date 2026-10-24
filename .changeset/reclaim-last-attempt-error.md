---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

A job whose attempt is reclaimed after it expired now records the failure: `lastAttemptAt` is set and `lastAttemptError` holds a serialized `JobAttemptExpiredError`, so the next attempt and the dashboard can tell a reclaimed attempt from a clean first run. Custom state adapters must accept the new `lastAttemptError` param on `reclaimExpiredJobAttempt` and stamp both fields.

- The dashboard shows a reclaimed job with the failed-last-attempt warning.
- New exported `JobAttemptExpiredError`, carrying `reclaimedBy` (the worker that reclaimed the attempt).
