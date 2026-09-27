---
"@queuert/sqlite": major
"@queuert/postgres": major
---

Remove `vacuum()` from both state adapters and drop the SQLite pragma guards. `migrateToLatest()` no longer inspects `PRAGMA foreign_keys` or `PRAGMA auto_vacuum`, and the `checkForeignKeys` and `checkAutoVacuum` options are gone — the SQLite adapter now runs on any database, whatever its pragma settings.

- `vacuum()` is no longer exposed by `createSqliteStateAdapter()` or `createPgStateAdapter()`; remove the call from cleanup jobs. Space freed by deletions is reused by both engines without it.
- `checkForeignKeys` and `checkAutoVacuum` are no longer accepted; remove them from `createSqliteStateAdapter()` calls.
- `PRAGMA foreign_keys = ON` and `PRAGMA auto_vacuum = INCREMENTAL` are no longer needed on your connections.
- To shrink a database file or rewrite a bloated table, run `VACUUM` (PostgreSQL: `VACUUM FULL`) yourself, out of band — both take heavy locks and are not something a cleanup job should do on every pass.
