# @queuert/mysql

## 0.18.0

### Minor Changes

- 1499392: The state provider conformance helpers take `stateAdapterOptions`, so the suite can run against the adapter configuration your application uses. Before, every helper built its adapter with the defaults, so it could not run against a database migrated with another schema, table prefix or ID type, and custom ID generators were never exercised.

  - `createPgStateProviderConformanceContext`, `createMysqlStateProviderConformanceContext` and `createSqliteStateProviderConformanceContext` take `stateAdapterOptions` (the adapter's options besides its provider, and `dialect` for MySQL), create every adapter with them, and migrate and clear the tables they name.
  - `createRedisStateProviderConformanceContext` takes `stateAdapterOptions` besides its provider and `keyPrefix`; each case still writes under a key prefix of its own.
  - The PostgreSQL and SQLite `classifyError` cases and the MySQL isolation-level case no longer read the `queuert_job` table.

- 9bffa41: New experimental package `@queuert/mysql`: a state adapter for MySQL 8.4+ and MariaDB 11.4+ (InnoDB), so chains and jobs commit in the same transactions as application data kept in either server. One adapter serves both servers through a required `dialect` option, and, as on PostgreSQL, Queuert supports READ COMMITTED only: its own transactions open at READ COMMITTED, and transactions you pass in must use it too. There is no notify adapter: pair it with the Redis or NATS notify adapter, or let workers poll.

  - `createMysqlStateAdapter({ stateProvider, dialect, schema?, tablePrefix?, jobIdType?, workerIdType?, … })` with the `MysqlStateAdapter` and `MysqlStateProvider` types; `jobIdType` and `workerIdType` take `"uuid"` or `"varchar(n)"`.
  - `migrateToLatest()` installs the schema with idempotent statements, so a run that stopped partway resumes.
  - Type names, deduplication keys and text ids use an exact NO PAD binary collation, and timestamps are stored as UTC `DATETIME(6)` whatever the server or session time zone.
  - `createMysqlMigrator` runs your application's own migrations with the same lease and history as `createPgMigrator`; DDL commits implicitly on MySQL and MariaDB, so schema changes belong in rerunnable `non-transactional` migrations.
  - `@queuert/mysql/conformance` exports `mysqlStateProviderConformanceCases`, `mysqlMigratorConformanceCases` and their context helpers to check a provider you write; the `state-mysql-mysql2` example is a reference provider for mysql2.
  - The migrator conformance cases gain one that checks a failing transactional migration rolls back its row writes, and the DDL rollback case moved into its own group, so stores whose servers commit DDL implicitly can run the rest; `pgMigratorConformanceCases` and `sqliteMigratorConformanceCases` include the new case.

- Queuert 0.18 can run synchronously inside your driver's own transaction. It adds experimental MySQL/MariaDB and Redis state adapters, a broker-free IPC notify adapter and a public migrator for your own migrations. Schema fencing protects state across upgrades, and the release reworks tx hooks, the worker runner, job type codecs and adapter conformance, with breaking API changes and a Node.js 24 minimum.

### Patch Changes

- 9e6c2b5: Functions that run in both synchronous and asynchronous mode now carry their real names in stack traces and CPU profiles, and a synchronous client or in-process state adapter given a callback that returns a promise reports it with one shared error message.

  - Compiled functions are named after the variable or property they belong to, such as `createChainSync` and `createChainAsync`, instead of `sync` and `async`.
  - A promise returned to a synchronous `completeChain` handler, `completeJob` callback or in-process `withTransaction` callback throws "A synchronous step got a promise: the value must be synchronous".

- Updated dependencies [8e6214a]
- Updated dependencies [5faa717]
- Updated dependencies [23481af]
- Updated dependencies [fa5f72e]
- Updated dependencies [9358147]
- Updated dependencies [77e02a0]
- Updated dependencies [bce5c32]
- Updated dependencies [aedda52]
- Updated dependencies [68cb9eb]
- Updated dependencies [0834205]
- Updated dependencies [9832912]
- Updated dependencies [b1c0838]
- Updated dependencies [6df6caf]
- Updated dependencies
- Updated dependencies [cb19191]
- Updated dependencies [e4244e4]
- Updated dependencies [9e6c2b5]
- Updated dependencies [bce5c32]
- Updated dependencies [cf464c5]
- Updated dependencies [747cd37]
- Updated dependencies [cf464c5]
  - queuert@0.18.0
