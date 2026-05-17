---
"queuert": patch
"@queuert/postgres": patch
"@queuert/sqlite": patch
---

Clear `lastAttemptError` when a job completes successfully. Previously, if a job failed an attempt and then succeeded on a retry, the completed row retained the error string from the prior failed attempt, making completed jobs appear to have errored. `completeJob` now resets `last_attempt_error` to `NULL` in the PostgreSQL, SQLite, and in-process adapters alongside the existing status/output/lease updates.
