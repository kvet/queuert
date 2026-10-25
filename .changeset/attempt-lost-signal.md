---
"queuert": major
"@queuert/otel": major
---

A worker that loses its attempt now reports it through one signal, `jobAttemptLost`, whatever the cause — another worker took the job, it was completed elsewhere, or it was deleted. Like `jobAttemptFailed`, it is reported once by the worker after the handler returns; previously deleted jobs and attempts that never reached `complete` reported no loss at all. The typed errors thrown by `complete` are unchanged. The per-heartbeat `extended` and the `expired` attempt signals are removed, since a lost attempt is reported by `jobAttemptLost` and a successful heartbeat is not worth an event.

- `ObservabilityAdapter`: `jobAttemptTakenByAnotherWorker` and `jobAttemptAlreadyCompleted` are replaced by `jobAttemptLost(data: JobAttemptData & WorkerBasicData)`.
- `ObservabilityAdapter`: `jobAttemptExtended` and `jobAttemptExpired` are removed.
- `jobAttemptCompleted` is buffered on the `transactionHooks` passed to `complete` and reported when that transaction commits, after the other events `complete` buffers.
- Logs: `job_attempt_taken_by_another_worker` and `job_attempt_already_completed` are replaced by `job_attempt_lost` (`warn`); the `completedBy` field is gone. `job_attempt_extended` and `job_attempt_expired` are removed.
- `@queuert/otel`: the `queuert.job.attempt.taken_by_another_worker` and `queuert.job.attempt.already_completed` counters are replaced by `queuert.job.attempt.lost`; `queuert.job.attempt.extended` and `queuert.job.attempt.expired` are removed.
