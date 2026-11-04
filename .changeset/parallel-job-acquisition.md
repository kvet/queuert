---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

The in-process worker acquires jobs in batches sized to its idle slots, so filling `N` slots costs one database round-trip instead of `N`, and throughput at higher `concurrency` is no longer capped by the latency of a single acquisition. Custom state adapters must implement the batched methods.

- `StateAdapter.startJobAttempt` is replaced by `startJobAttempts`, which takes a `limit` and returns an array of up to `limit` acquired jobs.
