---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

Completing a chain that no job depends on skips the unblock step entirely, saving a database round trip on every such completion. The PostgreSQL adapter records this on the chain's head row in a new `has_dependents` column, added by the `003_blocker_counters` migration. Stop every process running 0.17 before the migration runs: a 0.17 process attaches blockers without setting the flag, so their dependents would stay blocked.

- `StateAdapter.completeJobs` returns `hasDependents` on each result, and core calls `unblockJobs` only when it is `true`; custom state adapters must report it.
- PostgreSQL migration `003_blocker_counters` adds `job.has_dependents` and backfills it on every chain a `job_blocker` row references.
