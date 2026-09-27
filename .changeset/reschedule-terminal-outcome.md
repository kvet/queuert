---
"queuert": major
"@queuert/otel": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

Add `finish({ reschedule })` as a non-error rescheduling outcome for attempt handlers and delete the `rescheduleJob()` helper exported from `queuert` together with `RescheduleJobError`. A requested reschedule no longer travels the error path — it skips `lastAttemptError`, does not emit `jobAttemptFailed`, and the attempt span ends `ok`.

- `finish({ reschedule: { afterMs } })` or `finish({ reschedule: { at } })` returns the job to pending as a first-class outcome alongside `{ output }` and `{ continueWith }`.
- The top-level `rescheduleJob()` helper (called inside an attempt handler, where it throws) and `RescheduleJobError` are removed from the public API. Migrate: `rescheduleJob({ afterMs })` → `return complete(async ({ finish }) => finish({ reschedule: { afterMs } }))`.
