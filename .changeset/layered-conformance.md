---
"queuert": major
"@queuert/postgres": minor
"@queuert/sqlite": minor
"@queuert/redis": minor
---

The conformance suites are lists of cases you run with your own test runner, one test per case, instead of runners that drive the whole suite inside a single test. Your test file owns the database or broker connections in its own hooks and registers a test for each case; `case.run(context)` resolves when the case passes and rejects when it fails. Each case creates its own adapter from the context's `createStateAdapter` and closes it when it ends; the provider helpers take a provider factory (`createStateProvider` or `createNotifyProvider`), build each case's adapter over a new provider from it, and clear the tables for every state case. This works the same under vitest, `node:test` and `bun:test`, and failures and filters show per case. The state adapter cases are split by what an adapter can do, and each adapter package ships cases for the providers you write for it, with a helper that migrates the schema and builds the adapters over providers from your factory.

- `queuert/conformance`: `stateAdapterConformanceCases`, `concurrentStateAdapterConformanceCases`, `notifyAdapterConformanceCases` and `validationAdapterConformanceCases`, plus the `ConformanceTestCase` type.
- `StateConformanceFixture` and `NotifyConformanceFixture` are renamed `StateAdapterConformanceContext` and `NotifyAdapterConformanceContext`.
- The countCap case is no longer part of `stateAdapterConformanceCases`: it needs an adapter created with a small `countCap`.
- `StateAdapterConformanceContext` takes `createStateAdapter` in place of `stateAdapter`, and `NotifyAdapterConformanceContext` takes `createNotifyAdapter` in place of `notifyAdapter`; the adapters a case creates are closed when it ends.
- `withNonTransactionContext` is required on `StateAdapterConformanceContext` and on the PostgreSQL and SQLite provider context helpers, so the `isTransaction` case always runs.
- Removed from `queuert/conformance`: `runStateAdapterConformance`, `runNotifyAdapterConformance`, `runValidationAdapterConformance`, `ConformanceError`, `ConformanceReport`, `ConformanceResult`, the conformance options types, `ValidationConformanceFixture` (use `ValidationAdapterConformanceContext`), and the contexts' `transactionConcurrency`, `dispose` and `reset` fields.
- New `@queuert/postgres/conformance` with `pgStateProviderConformanceCases`, `createPgStateProviderConformanceContext`, `pgNotifyProviderConformanceCases` and `createPgNotifyProviderConformanceContext`.
- New `@queuert/sqlite/conformance` with `sqliteStateProviderConformanceCases` and `createSqliteStateProviderConformanceContext`.
- New `@queuert/redis/conformance` with `redisNotifyProviderConformanceCases` and `createRedisNotifyProviderConformanceContext`.
