---
"queuert": major
"@queuert/postgres": minor
"@queuert/sqlite": minor
"@queuert/redis": minor
---

The state adapter conformance suite is split by what an adapter can do, and each adapter package checks the providers you write for it. `runStateAdapterConformance` runs the cases every adapter must pass, and adapters that run transactions in parallel also run `runConcurrentStateAdapterConformance`. To test a provider for PostgreSQL, SQLite or Redis, use that package's `conformance` runner, which builds the adapter from your provider, migrates and truncates it, and runs the cases that apply to it.

- `queuert/conformance`: new `runConcurrentStateAdapterConformance`; the fixture's `transactionConcurrency` field is removed; `StateConformanceOptions`, `NotifyConformanceOptions`, `ValidationConformanceOptions` and `ConformanceRunOptions` are replaced by `ConformanceOptions`.
- New `@queuert/postgres/conformance` with `runPgStateProviderConformance` and `runPgNotifyProviderConformance`.
- New `@queuert/sqlite/conformance` with `runSqliteStateProviderConformance`.
- New `@queuert/redis/conformance` with `runRedisNotifyProviderConformance`.
