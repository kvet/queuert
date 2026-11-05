---
"queuert": minor
"@queuert/postgres": minor
"@queuert/sqlite": minor
"@queuert/dashboard": patch
---

State providers can supply transaction hooks implicitly. A provider that implements `getTransactionHooks` binds `transactionHooks` to each transaction it recognizes, typically from the app's own transaction helper, so `createChain`, the other mutating client methods and `complete` take only the transaction context. Providers without it keep the explicit mode, where callers pass `transactionHooks` as before.

- `PgStateProvider`, `SqliteStateProvider`, `StateAdapter`, `PgStateAdapter` and `SqliteStateAdapter` gain a last `TTransactionHooksMode` type parameter (`"explicit"` by default, or `"implicit"`).
- With an implicit adapter, `transactionHooks` is rejected by the type checker and at runtime, and a transaction with no bound hooks throws.
- With an implicit adapter, the worker waits for a written `complete` whose transaction has not settled yet before deciding the attempt's outcome.
- The dashboard's reschedule and delete actions work with implicit adapters.
