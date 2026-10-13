---
"queuert": patch
---

`createInProcessWorker` now rejects invalid backoff and attempt config when it is created, instead of failing later while processing jobs.

- Throws a `TypeError` naming each invalid field when `recoveryBackoffConfig`, a `backoffConfig` or an `attemptConfig` (worker defaults or per processor) holds `NaN`, a negative value, or a zero `multiplier`, `timeoutMs` or `heartbeatMs`.
- `Infinity` is rejected everywhere except `maxDelayMs`, where it still means no cap.
