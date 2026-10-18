---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

Attempt-scoped writes are now fenced on the attempt number as well as the worker. A worker with `concurrency > 1` could re-acquire a job one of its slots had lost (the attempt was reclaimed, then picked up by another slot) and the stale slot still passed the ownership check and finished the job; it now fails with `JobTakenByAnotherWorkerError`. Custom state adapters must implement the fence.
