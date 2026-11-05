---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

In-process workers no longer reschedule running jobs that hold no attempt token, which only a worker of a version before 0.17 claims. Upgrade from a version before 0.17 through 0.17 and let every process on the previous version stop before deploying this version, or a job such a process claims stays running.

- `StateAdapter.listWorkerJobs` no longer accepts `workerId: null`; custom state adapters can drop the listing of running jobs without an attempt token.
