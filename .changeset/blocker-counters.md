---
"queuert": major
"@queuert/postgres": major
"@queuert/mysql": major
"@queuert/sqlite": major
"@queuert/redis": major
---

Every SQL state adapter and the Redis state adapter now record on each chain's head whether any job depends on the chain, so completing a chain that no job depends on skips the unblock step, and `listChains` with `independent: false` reads an index of those chains instead of checking every chain of the type. The new `has_dependents` column and `chain_has_dependents_idx` index come with the breaking `002_blocker_counters` migration on PostgreSQL, SQLite and MySQL/MariaDB, which replaces the `schema_fence_v1` write fence with `schema_fence_v2`: processes on 0.18 fail their writes with `SchemaFencedError` once it runs, so stop them after deploying, and stop every 0.17 PostgreSQL or SQLite process before it runs. The Redis adapter's breaking `002_chain_has_dependents` migration does the same with its `schema-fences` version.

- `StateAdapter.completeJobs` returns `hasDependents` on each result, and core calls `unblockJobs` only when it is `true`; custom state adapters must report it.
- Migration `002_blocker_counters` adds `job.has_dependents`, backfills it on every chain a `job_blocker` row references, creates `chain_has_dependents_idx` and bumps the write fence to version 2.
- `listChains` filtered by `independent` checks the flag before looking for blocker rows.
- Redis migration `002_chain_has_dependents` adds `hasDependents` to the head job records the `blocker-references` hash names, adds them to the new `dependent-chains:*` sorted sets and replaces write fence version 1 with 2.
