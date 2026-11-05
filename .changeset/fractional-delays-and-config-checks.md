---
"queuert": patch
---

`createInProcessWorker` now rejects invalid concurrency, poll interval, backoff and lease config when it is created, instead of failing later while processing jobs.

- Throws a `TypeError` naming each invalid field when `recoveryBackoffConfig`, a `backoffConfig` (worker-level or per processor) or `leaseConfig` holds `NaN`, a negative value, or a zero `multiplier`, `durationMs` or `heartbeatMs`.
- Throws the same `TypeError` when `concurrency` is not a positive integer or `pollIntervalMs` is not a positive finite number.
- `Infinity` is rejected everywhere except `maxDelayMs`, where it still means no cap.
