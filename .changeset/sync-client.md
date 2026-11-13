---
"queuert": major
"@queuert/sqlite": minor
"@queuert/dashboard": patch
---

Users with a SQLite driver that runs statements synchronously can call Queuert inside the driver's own synchronous transaction, such as `db.transaction(() => …)()`. The client follows its state adapter's mode: over a `SyncStateAdapter`, `createClient` returns a client whose state-touching methods, workerless `completeChain`, and the attempt handler's `complete` and `fence` return plain values and throw synchronously, so an error rolls the transaction back. Over an async `StateAdapter` they return promises as before. `createProcessors`, `createWorkerRunner`, `withTxHooks` and `createTxHooks` are the same API in both modes.

- New in `queuert`: `SyncStateAdapter` and `SyncNotifyAdapter`, which an adapter implements by setting `sync: true`, plus `AnyStateAdapter`, `AnyNotifyAdapter`, `StateAdapterOperations`, `NotifyAdapterOperations`, `AdapterMode`, `AdapterModeOf` and `ModeResult`.
- `createClient` takes a state adapter and a notify adapter of either mode, and `Client` types its methods by the state adapter's mode; `awaitChain` returns a promise in both.
- Over a synchronous client, the handlers of `createProcessors` get a synchronous `complete` and `fence`, and the worker runner keeps its async `start`, `stop`, `close` and `[Symbol.asyncDispose]`.
- `withTxHooks` returns the callback's value and runs the commit callbacks synchronously when the callback returns a plain value, and throws after every commit callback has run if one of them returned a promise; `createTxHooks().flush()` returns a promise only when a commit callback returned one.
- Attempt middleware passed to `createProcessors` must be typed for the client's state adapter: middleware typed for a different concrete state adapter is a compile error.
- `createDashboard` accepts a client over a state adapter of either mode.
- New in `queuert/conformance`: `syncStateAdapterConformanceCases`, `syncNotifyAdapterConformanceCases`, `syncStateAdapterEndToEndConformanceCases` and `syncNotifyAdapterEndToEndConformanceCases`, which run against the existing `StateAdapterConformanceContext` and `NotifyAdapterConformanceContext`, plus the `ConformanceStateAdapter` and `ConformanceNotifyAdapter` types those contexts accept.
- New in `@queuert/sqlite`: `SyncSqliteStateProvider` (a provider with `sync: true`), `SyncSqliteStateAdapter` and `SqliteStateProviderOperations`, the members both provider kinds share. `createSqliteStateAdapter` returns a `SyncSqliteStateAdapter` over a `SyncSqliteStateProvider`; a synchronous provider takes no lock, implements synchronous `onTransactionCommit` and `onTransactionRollback` (carrying `TxHooks` in its context when the driver has no transaction events), and its `executeSql` throws when a statement without `txCtx` finds the connection inside an open transaction.
- `Migrator`, `Migration` and `MigrationScript` in `@queuert/sqlite` take an optional mode parameter (`"async"` by default): `createSqliteMigrator` returns a `Migrator<"sync">` over a `SyncSqliteStateProvider`, which takes `Migration<TTxContext, "sync">` migrations and no lease.
- New in `@queuert/sqlite/conformance`: `syncSqliteStateProviderConformanceCases` and `syncSqliteMigratorConformanceCases`. `createSqliteStateProviderConformanceContext` and `createSqliteMigratorConformanceContext` accept a `SyncSqliteStateProvider`, and the state provider context is returned directly for one.
