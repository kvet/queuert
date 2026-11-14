---
"@queuert/postgres": minor
"@queuert/mysql": minor
"@queuert/sqlite": minor
"@queuert/redis": minor
---

The state provider conformance helpers take `stateAdapterOptions`, so the suite can run against the adapter configuration your application uses. Before, every helper built its adapter with the defaults, so it could not run against a database migrated with another schema, table prefix or ID type, and custom ID generators were never exercised.

- `createPgStateProviderConformanceContext`, `createMysqlStateProviderConformanceContext` and `createSqliteStateProviderConformanceContext` take `stateAdapterOptions` (the adapter's options besides its provider, and `dialect` for MySQL), create every adapter with them, and migrate and clear the tables they name.
- `createRedisStateProviderConformanceContext` takes `stateAdapterOptions` besides its provider and `keyPrefix`; each case still writes under a key prefix of its own.
- The PostgreSQL and SQLite `classifyError` cases and the MySQL isolation-level case no longer read the `queuert_job` table.
