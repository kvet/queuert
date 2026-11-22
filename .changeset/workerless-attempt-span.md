---
"queuert": major
"@queuert/otel": major
---

Every outcome `applyJobOutcome` or `applyJobOutcomes` applies is traced with the same `start job-attempt.{type}` CONSUMER span as a worker attempt, ending right away and without `queuert.worker.id`: a completion or continuation in place of a `complete job.{type}` span, and a reschedule, which emitted no span, with `queuert.reschedule.reason`.

- Removed `completeJobSpan` and `CompleteJobSpanInputData` from `ObservabilityAdapter`; a custom adapter drops the method.
- `JobAttemptSpanInputData.workerId` is `null` for an outcome the client applies.
