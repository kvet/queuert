---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

Mutating client methods now reject a transaction context that is not inside an open transaction. Previously, passing a pool, the root ORM handle, or an idle connection where the transaction belonged was accepted: each statement of a multi-statement write committed on its own, so a failure partway could leave a job completed with its dependents still blocked, and `lock: "exclusive"` locks were released immediately, reopening the blocker-attach race. The check reads the driver's own transaction state synchronously and adds no database round trip.

- `PgStateProvider` and `SqliteStateProvider` gain a required `isTransaction(txCtx)` method; custom providers must implement it from the driver's state (e.g. Kysely `db.isTransaction`, Knex `trx.isTransaction`, pg `client.getTransactionStatus()`, better-sqlite3 `db.inTransaction`, node:sqlite `db.isTransaction`).
- `StateAdapter` gains a required `isTransaction(txCtx)` method; the built-in adapters forward it to the provider.
- `createChain`, `createChains`, `completeChain`, `deleteChain(s)` and `rescheduleJob(s)` throw when the adapter reports the context as outside a transaction.
- The state adapter conformance suite checks `isTransaction` and accepts an optional `withNonTransactionContext` fixture to verify the negative case.
