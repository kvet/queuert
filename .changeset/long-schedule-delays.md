---
"queuert": patch
"@queuert/postgres": patch
---

Schedules, attempt timeouts, and `awaitChain` timeouts longer than about 24.8 days (2^31-1 ms) now work. The PostgreSQL adapter rejected them, and a pending job scheduled that far ahead made every idle worker's main loop fail and restart with an ever-growing backoff.

- PostgreSQL: `schedule: { afterMs }` on `createChain`, `continueWith`, and `reschedule`, and attempt timeouts above 2^31-1 ms, no longer fail with "interval field value out of range" ([#5](https://github.com/kvet/queuert/issues/5)).
- PostgreSQL: a pending job scheduled more than about 24.8 days ahead no longer makes `getStartAttemptDelayMs` fail with "integer out of range" on every idle worker cycle ([#6](https://github.com/kvet/queuert/issues/6)).
- The worker's `recoveryBackoffConfig` backoff now resets once the loop recovers, so an isolated error later on waits the initial delay, not the maximum ([#6](https://github.com/kvet/queuert/issues/6)).
- `awaitChain` with a `timeoutMs` above 2^31-1 ms no longer times out almost immediately.
