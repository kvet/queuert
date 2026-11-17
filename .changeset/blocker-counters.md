---
"queuert": major
"@queuert/postgres": major
"@queuert/mysql": major
"@queuert/sqlite": major
"@queuert/redis": major
---

Every SQL state adapter and the Redis state adapter now record on each chain's head whether any job depends on the chain, so completing a chain that no job depends on skips the unblock step, and `listChains` with `independent: false` reads an index of those chains instead of checking every chain of the type. The PostgreSQL and MySQL/MariaDB adapters also keep on each blocked job a count of its incomplete blockers, which makes them correct at READ COMMITTED, REPEATABLE READ and SERIALIZABLE, mixed per transaction, and their providers stop pinning READ COMMITTED. The new columns and the `chain_has_dependents_idx` index come with the breaking `002_blocker_counters` migration on PostgreSQL, SQLite and MySQL/MariaDB, which replaces the `schema_fence_v1` write fence with `schema_fence_v2`: processes on 0.18 fail their writes with `SchemaFencedError` once it runs, so stop them after deploying, and stop every 0.17 PostgreSQL or SQLite process before it runs. The Redis adapter's breaking `002_chain_has_dependents` migration does the same with its `schema-fences` version.

- `StateAdapter.completeJobs` returns `hasDependents` on each result, and core calls `unblockJobs` only when it is `true`; custom state adapters must report it.
- Migration `002_blocker_counters` adds `job.has_dependents`, backfills it on every chain a `job_blocker` row references, creates `chain_has_dependents_idx` and bumps the write fence to version 2.
- On PostgreSQL and MySQL/MariaDB, `002_blocker_counters` also adds `job.blockers_remaining`, backfills it on every blocked job, moves blocked jobs whose blockers have all completed to `pending`, and moves `running` jobs whose worker no longer exists to `pending`.
- The PostgreSQL and MySQL/MariaDB adapters support READ COMMITTED, REPEATABLE READ and SERIALIZABLE for every transaction, and retry their own transactions and statements on conflicts the stricter levels raise (serialization failures, 40001, on PostgreSQL; deadlocks and snapshot conflicts, 1213/1020, on MySQL/MariaDB), up to five attempts; at the stricter levels, retry the transactions you pass to Queuert with fresh `txHooks` or inside `txHooks.retryBoundary`. PostgreSQL migrations always run at READ COMMITTED.
- The shipped `pg` and `mysql2` providers no longer pin READ COMMITTED: Queuert's transactions run at the connection's default level, so a server whose default is REPEATABLE READ (InnoDB's default) or SERIALIZABLE now runs them at that level; give Queuert's pool a READ COMMITTED default to keep the previous behavior and its claim throughput. On MySQL/MariaDB above READ COMMITTED, a claim on a drained queue takes gap locks that make inserts of new due jobs wait until it commits.
- `StateAdapter.withTransaction` may call its callback more than once, re-running it after a `transaction_conflict`; custom state adapters must allow it, and Queuert keeps every callback it passes free of side effects outside the database.
- Custom providers report conflicts through `classifyError` so the adapter can retry them: `PgErrorClassification` and `MysqlErrorClassification` gain `transaction_conflict` (40001 on PostgreSQL; 1213 and 1020 on MySQL/MariaDB); a provider that does not report them gets no retries.
- `listChains` filtered by `independent` checks the flag before looking for blocker rows.
- Redis migration `002_chain_has_dependents` adds `hasDependents` to the head job records the `blocker-references` hash names, adds them to the new `dependent-chains:*` sorted sets and replaces write fence version 1 with 2.
