---
"queuert": patch
---

`createInProcessWorker` now rejects invalid backoff config when it is created, instead of failing later while processing jobs.

- Throws a `TypeError` naming each invalid field when `recoveryBackoffConfig` or a `backoffConfig` (worker defaults or per processor) holds `NaN`, a negative value, or a zero `multiplier`.
- `Infinity` is rejected everywhere except `maxDelayMs`, where it still means no cap.
