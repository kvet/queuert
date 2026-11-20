---
"queuert": major
"@queuert/postgres": minor
"@queuert/mysql": minor
"@queuert/sqlite": minor
"@queuert/redis": patch
---

Rollback callbacks can be asynchronous, like commit callbacks: what a state provider registers with `onTransactionRollback` may return a promise, and the call that opened the transaction settles only after it does. `TxHooks` runs them the same way it runs commit callbacks, so a rollback's side effects no longer outlive the transaction call.

- `TxHooks.onRollback` accepts a callback that returns a promise, and `TxHooksHandle.discard()` returns a promise when one did; await it in a provider that calls `createTxHooks` directly.
- Rollback callbacks run when a savepoint or `retryBoundary` try rolls back start right away, and the `flush` or `discard` that ends the transaction awaits their promises, ignoring rejections.
- In a synchronous transaction, a rollback callback that returns a promise on a savepoint rollback makes the flush throw, as a commit callback that returns one does.
- `onTransactionRollback` on `StateAdapter`, `PgStateProvider`, `MysqlStateProvider` and `SqliteStateProvider` takes the same callback type as `onTransactionCommit`.
- The Redis state adapter awaits the rollback callbacks of a transaction it rolls back.
