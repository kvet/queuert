---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

The in-process worker acquires and reclaims jobs in batches sized to its idle slots, so filling `N` slots costs one database round-trip instead of `N`, and throughput at higher `concurrency` is no longer capped by the latency of a single acquisition. Custom state adapters must implement the batched methods.

- `StateAdapter.startJobAttempt` is replaced by `startJobAttempts`, which takes a `limit` and returns an array of up to `limit` acquired jobs.
- `StateAdapter.reclaimExpiredJobAttempt` is replaced by `reclaimExpiredJobAttempts`, which takes a `limit` and returns an array of up to `limit` released jobs.
- The worker reclaims up to its idle slot count of expired attempts per iteration, and sends one wake hint and `notifyJobScheduled` per reclaimed job type and one `notifyJobAttemptLost` per reclaimed job.
