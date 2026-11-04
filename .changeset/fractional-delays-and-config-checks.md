---
"queuert": patch
---

`createInProcessWorker` now rejects invalid backoff and lease config when it is created, instead of failing later while processing jobs.

- Throws a `TypeError` naming each invalid field when `recoveryBackoffConfig`, a `backoffConfig` (worker-level or per processor) or `lease` holds `NaN`, a negative value, or a zero `multiplier`, `durationMs` or `heartbeatMs`.
- `Infinity` is rejected everywhere except `maxDelayMs`, where it still means no cap.
