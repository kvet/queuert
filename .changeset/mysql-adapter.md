---
"@queuert/mysql": minor
"@queuert/postgres": patch
"@queuert/sqlite": patch
---

New experimental package `@queuert/mysql`: a state adapter for MySQL 8.4+ and MariaDB 11.4+ (InnoDB), so chains and jobs commit in the same transactions as application data kept in either server. One adapter serves both servers through a required `dialect` option, and, as on PostgreSQL, Queuert supports READ COMMITTED only: its own transactions open at READ COMMITTED, and transactions you pass in must use it too. There is no notify adapter: pair it with the Redis or NATS notify adapter, or let workers poll.

- `createMysqlStateAdapter({ stateProvider, dialect, schema?, tablePrefix?, jobIdType?, workerIdType?, … })` with the `MysqlStateAdapter` and `MysqlStateProvider` types; `jobIdType` and `workerIdType` take `"uuid"` or `"varchar(n)"`.
- `migrateToLatest()` installs the schema with idempotent statements, so a run that stopped partway resumes, and first checks the server version and dialect, that the connection has a default database, and that `sql_mode` is strict and does not include `NO_BACKSLASH_ESCAPES`.
- Type names, deduplication keys and text ids use an exact NO PAD binary collation, and timestamps are stored as UTC `DATETIME(6)` whatever the server or session time zone.
- `createMysqlMigrator` runs your application's own migrations with the same lease and history as `createPgMigrator`; DDL commits implicitly on MySQL and MariaDB, so schema changes belong in rerunnable `non-transactional` migrations.
- `@queuert/mysql/conformance` exports `mysqlStateProviderConformanceCases`, `mysqlMigratorConformanceCases` and their context helpers to check a provider you write; the `state-mysql-mysql2` example is a reference provider for mysql2.
- The migrator conformance cases gain one that checks a failing transactional migration rolls back its row writes, and the DDL rollback case moved into its own group, so stores whose servers commit DDL implicitly can run the rest; `pgMigratorConformanceCases` and `sqliteMigratorConformanceCases` include the new case.
