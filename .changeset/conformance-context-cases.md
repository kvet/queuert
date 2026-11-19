---
"queuert": major
"@queuert/postgres": major
"@queuert/mysql": major
"@queuert/sqlite": major
"@queuert/redis": major
---

Every conformance suite now comes from one call that returns its cases already bound to the options you pass, so each test just calls `conformanceCase.run()`: `queuert/conformance` exports `createStateAdapterConformanceCases`, `createStateAdapterEndToEndConformanceCases`, `createNotifyAdapterConformanceCases`, `createNotifyAdapterEndToEndConformanceCases` and `createValidationAdapterConformanceCases`, and `@queuert/postgres/conformance`, `@queuert/mysql/conformance`, `@queuert/sqlite/conformance` and `@queuert/redis/conformance` export `create…ConformanceCases` for their providers and migrators. Each call is synchronous and runs its setup (such as migrating the schema) lazily before the first case, so you make it where you register the tests and build your pool or client in `beforeAll`.

- `queuert/conformance` no longer exports the case lists (`stateAdapterConformanceCases`, `asyncStateAdapterConformanceCases`, `concurrentStateAdapterConformanceCases`, `stateAdapterEndToEndConformanceCases`, `asyncStateAdapterEndToEndConformanceCases`, `concurrentStateAdapterEndToEndConformanceCases`, `notifyAdapterConformanceCases`, `notifyAdapterEndToEndConformanceCases`, `validationAdapterConformanceCases`) or the context types (`StateAdapterConformanceContext`, `NotifyAdapterConformanceContext`, `ValidationAdapterConformanceContext`); `createStateAdapterConformanceCases` and `createStateAdapterEndToEndConformanceCases` take a required `mode` (`"sync"` or `"async"`) that adds the async-only cases, and `concurrent: true` adds the cases that hold two transactions open at once.
- `ConformanceTestCase` is no longer generic: its `run()` takes no context.
- The provider suites' `create…ConformanceContext` functions are renamed to `create…ConformanceCases` and return the cases instead of a context; the provider entry points no longer export their case lists, `redisStateAdapterLockWaitCaseNames` or their context types, and re-export only `ConformanceTestCase`.
- `createSqliteStateProviderConformanceCases` and `createSqliteMigratorConformanceCases` take a required `mode` (`"sync"` or `"async"`) that must match the provider, checked by type and at runtime; `"async"` includes the cases that hold a transaction open across an `await`.
- The migrator suites take `createStateProvider: () => provider` instead of `stateProvider`, called once when the first case runs.
