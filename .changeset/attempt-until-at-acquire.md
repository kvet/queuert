---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

An attempt's deadline (`attemptUntil`) is set the moment the job is acquired, from the processor's `attemptConfig.timeoutMs`, so a running job always carries a deadline.

- `attemptUntil` holds from acquire until the first heartbeat extends it.
- `attemptUntil` on a running `Job` is typed `Date` instead of `Date | null`.
