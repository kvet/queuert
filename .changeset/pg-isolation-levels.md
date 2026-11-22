---
"queuert": minor
"@queuert/postgres": major
"@queuert/redis": major
---

The PostgreSQL adapter is correct at READ COMMITTED, REPEATABLE READ and SERIALIZABLE, set as the session default or per transaction and mixed across transactions, and the shipped `pg` provider stops pinning READ COMMITTED. Whenever two transactions act on the same jobs, both write a shared row, so at the stricter levels the later one fails with a serialization failure (40001) instead of acting on a stale snapshot.

- The adapter retries the transactions and statements it runs itself (acquisition, lease renewal, reclaims) on serialization failures (40001) and deadlocks (40P01), as `transactionRetry` configures; retry the transactions you pass to Queuert yourself at the stricter levels, with fresh `txHooks` or inside `txHooks.retryBoundary`. `StateAdapter.withTransaction` may therefore call its callback more than once.
- The `pg` provider opens transactions with a plain `BEGIN`, so Queuert's own work runs at the connection's default level; give Queuert's pool a READ COMMITTED default to keep the previous behavior and its acquisition throughput. Migrations, Queuert's own and `createPgMigrator`'s, always run at READ COMMITTED.
- `PgErrorClassification` gains `{ kind: "transaction_conflict" }`; a custom provider's `classifyError` returns it for SQLSTATE 40001 and 40P01, or the adapter does not retry.
- `createPgStateAdapter` takes `transactionRetry` (default `{ maxTries: 5, initialDelayMs: 50, maxDelayMs: 50 }`), the most tries and the backoff between them for the transactions and statements the adapter runs itself. Its type, `RetryConfig` (a `BackoffConfig` with `maxTries`, each retry waiting a random delay up to the backoff of the failed try), is exported from `queuert` and `@queuert/postgres`.
- `createRedisStateAdapter` takes the same `transactionRetry` (default `{ maxTries: 50, initialDelayMs: 2, multiplier: 2, maxDelayMs: 50 }`) in place of `maxTransactionTries`; pass `{ maxTries: n, initialDelayMs: 2, multiplier: 2, maxDelayMs: 50 }` for the previous `maxTransactionTries: n`.
- `createPgStateProviderConformanceCases` runs at the isolation level of the provider's transactions, and checks that `withTransaction` runs no statement before its callback, so the migrations' `SET TRANSACTION` takes effect.
