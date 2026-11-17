---
"@queuert/postgres": major
"@queuert/mysql": major
"@queuert/sqlite": major
"@queuert/redis": major
---

The provider conformance suites in `@queuert/postgres/conformance`, `@queuert/mysql/conformance`, `@queuert/sqlite/conformance` and `@queuert/redis/conformance` no longer export case lists: each `create…ConformanceContext` returns `{ context, cases }`, with the cases already chosen for your provider, and runs its setup (such as migrating the schema) lazily before the first case, so you call it where you register the tests and build your pool or client in `beforeAll`.

- Removed `pgStateProviderConformanceCases`, `pgNotifyProviderConformanceCases`, `pgMigratorConformanceCases`, `mysqlStateProviderConformanceCases`, `mysqlMigratorConformanceCases`, `sqliteStateProviderConformanceCases`, `asyncSqliteStateProviderConformanceCases`, `sqliteMigratorConformanceCases`, `redisStateProviderConformanceCases`, `redisNotifyProviderConformanceCases` and `redisStateAdapterLockWaitCaseNames`; iterate the returned `cases` instead.
- `createPgStateProviderConformanceContext` and `createMysqlStateProviderConformanceContext` take a required `isolationLevel` (`"READ COMMITTED"`, `"REPEATABLE READ"` or `"SERIALIZABLE"`), and the suite checks that your provider's transactions run at it; on MySQL, `"SERIALIZABLE"` leaves out the cases that rely on a plain read inside a transaction taking no lock.
- `createSqliteStateProviderConformanceContext` and `createSqliteMigratorConformanceContext` take a required `mode` (`"sync"` or `"async"`) that must match the provider, checked by type and at runtime; `"async"` includes the cases that hold a transaction open across an `await`.
- The migrator conformance contexts take `createStateProvider: () => provider` instead of `stateProvider`, called once when the first case runs.
- The state provider conformance contexts are created synchronously and no longer return a promise.
