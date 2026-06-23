---
"queuert": minor
"@queuert/otel": minor
---

Expose job abort reasons to OTel tracing as an `abort` event on the attempt span. When a job's signal is aborted (e.g. `worker_stopping`, `taken_by_another_worker`, `already_completed`), an event is recorded on the attempt span with `queuert.abort.reason` as an attribute, giving operators the exact timestamp and reason for the interruption.
