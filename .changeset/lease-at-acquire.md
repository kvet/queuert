---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

An attempt's lease (`attemptUntil`) is set the moment the job is acquired, from the processor's `attemptConfig.timeoutMs`, so a running job always carries a deadline.

- A staged attempt's prepare transaction no longer extends the lease before committing; the lease runs from acquire until the first heartbeat renews it.
- `attemptUntil` on a running `Job` is typed `Date` instead of `Date | null`.
