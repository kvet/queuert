---
"@queuert/mysql": major
"@queuert/postgres": patch
"@queuert/sqlite": patch
---

The MySQL and MariaDB adapter is correct when the transactions you pass to Queuert run at READ COMMITTED, REPEATABLE READ (InnoDB's default) or SERIALIZABLE, set as the session default or per transaction and mixed across transactions, with REPEATABLE READ and SERIALIZABLE experimental. The reads that decide blocker bookkeeping, chain deletion and ownership checks in such a transaction are locking reads, so they see the latest committed row instead of a stale snapshot; deduplication on create stays best-effort at the stricter levels, as on PostgreSQL. The transactions Queuert opens itself stay at READ COMMITTED, since locking scans at REPEATABLE READ take gap locks that stall inserts of new jobs.

- The adapter retries the transactions and statements it runs itself (acquisition, lease renewal, reclaims) on deadlocks (1213) and MariaDB snapshot conflicts (1020), as the new `transactionRetry` option configures (default `{ maxTries: 5, initialDelayMs: 50, maxDelayMs: 50 }`); retry the transactions you pass to Queuert yourself, with fresh `txHooks` or inside `txHooks.retryBoundary`. `StateAdapter.withTransaction` may therefore call its callback more than once.
- `MysqlErrorClassification` gains `{ kind: "transaction_conflict" }`; a custom provider's `classifyError` returns it for errors 1213 and 1020, or the adapter does not retry.
- `deleteChains` refuses to delete a chain that a dependent was attached to while the delete waited for its locks, and on MariaDB `getChains` with a lock returns the head as committed, not as of the transaction's snapshot.
- Migration transactions, Queuert's own and `createMysqlMigrator`'s, serialize on a turn row in the lease table (`id = 2`), so they take turns even before the history has rows, and acquiring the lease treats a deadlock as not acquired.
- `createMysqlStateProviderConformanceCases` checks that `classifyError` reports a deadlock as `transaction_conflict`.
- The migrator conformance cases (`createMysqlMigratorConformanceCases`, `createPgMigratorConformanceCases`, `createSqliteMigratorConformanceCases`) check that a migration transaction waits for an open one while the history is empty.
