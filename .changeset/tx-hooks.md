---
"queuert": major
"@queuert/dashboard": patch
---

Transaction hooks are renamed to tx hooks across the library and gain `txHooks.retryBoundary` for drivers that rerun the transaction callback (MongoDB's `session.withTransaction`, Mongoose's `connection.transaction`, or a retry loop inside `withTxHooks`). Rename `transactionHooks` to `txHooks` in every client, `complete` and workerless call, and `withTransactionHooks` / `createTransactionHooks` to `withTxHooks` / `createTxHooks`. Custom hooks move from the keyed hook registry to `txHooks.onCommit(callback)` and `txHooks.onRollback(callback)`, which roll back with savepoints and `retryBoundary` tries on their own, so side effects registered in a rolled-back savepoint never run.

- Renamed: `withTransactionHooks` → `withTxHooks`, `createTransactionHooks` → `createTxHooks`, `TransactionHooks` → `TxHooks`, `TransactionHooksHandle` → `TxHooksHandle`, `TransactionHooksSavepoint` → `TxHooksSavepoint`, and the `transactionHooks` option field → `txHooks`.
- New `txHooks.retryBoundary(fn)`: each rerun of `fn` rolls back what the previous try buffered, so a `complete` in a rolled-back try no longer blocks the retry and its events no longer flush.
- The worker runs its own transactions (registration, reclaiming expired or finished attempts, stop) inside `retryBoundary`, so a state adapter whose `withTransaction` reruns its callback no longer reports a reclaim twice.
- Registering a hook, opening a savepoint or starting a `retryBoundary` try on tx hooks that were already flushed or discarded throws, instead of buffering a side effect that never runs; rolling back an earlier savepoint at that point does nothing.
- Removed: `txHooks.set`, `get`, `has`, `delete` and `getOrInsert`, the `HookDefinition` type and `HookNotRegisteredError`. Register `txHooks.onCommit(() => …)` for work after commit and `txHooks.onRollback(() => …)` for compensation; aggregate or deduplicate inside the callback.
- `onRollback` callbacks run newest first when a savepoint or `retryBoundary` try rolls back or the hooks are discarded, and must be synchronous; the handle's `discard()` returns `void` instead of a promise.
- Rolling back a savepoint releases every savepoint created after it, so rolling one of those back afterwards does nothing.
- The docs guide moves to `/guides/tx-hooks/`.
- With knex, pass `{ doNotRejectOnRollback: false }` to `knex.transaction` so a bare `trx.rollback()` rejects instead of flushing the hooks.
