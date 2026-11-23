---
"queuert": minor
"@queuert/otel": minor
---

Attempt logs and traces name the worker runner slot that ran the attempt, so concurrent attempts of one worker can be told apart.

- The `job_attempt_started`, `job_attempt_completed`, `job_attempt_failed` and `job_attempt_lost` log entries and the matching `ObservabilityAdapter` hooks carry `workerSlot`, from `0` to `concurrency - 1`.
- `startAttemptSpan` receives `workerSlot`, `null` when the client applies the outcome, and the OpenTelemetry adapter sets it as the `queuert.worker.slot` attribute of the `start job-attempt` span.
