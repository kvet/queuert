---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

State providers own commit and rollback callbacks. `PgStateProvider`, `SqliteStateProvider` and `StateAdapter` require `onTransactionCommit(txCtx, callback)` and `onTransactionRollback(txCtx, callback)`, and the client and worker register their side effects only through them. A provider over an ORM with its own transaction events (such as MikroORM) implements them natively, so callers pass the transaction context alone; a provider without them carries `txHooks` in its transaction context, creates them in `withTransaction` with `withTxHooks`, and registers callbacks on them, so callers keep passing `txHooks`, now as a field of that context.

- `txHooks` is no longer a separate option of `complete` and the client's mutating methods; whatever the provider's context type requires is required for mutating calls and optional for reads.
- `fence` takes a partial transaction context, as reads do.
- The `completeChain` handler's `completeJob` callback no longer receives `txHooks`; register side effects on the transaction context you passed.
- `createPgStateProviderConformanceContext` and `createSqliteStateProviderConformanceContext` accept an optional `withSavepoint`; when given, the provider cases check that `onTransactionCommit` and `onTransactionRollback` follow savepoints.
- `complete` succeeds once per attempt instead of once per `txHooks`: a second or concurrent call throws without aborting the attempt, and a call whose transaction rolled back can be retried in a new transaction.
