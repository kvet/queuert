---
"@queuert/sqlite": major
"@queuert/postgres": major
---

Remove `vacuum()` from both state adapters and drop the SQLite pragma guards. `migrateToLatest()` no longer inspects `PRAGMA foreign_keys` or `PRAGMA auto_vacuum`, and the `checkForeignKeys` and `checkAutoVacuum` options are gone — the SQLite adapter now runs on any database, whatever its pragma settings. None of this was doing the work it claimed: the schema declares no foreign keys, so `PRAGMA foreign_keys = ON` enforced nothing; SQLite already puts the pages a delete frees onto the freelist and reuses them for later inserts, so a queue database stops growing without incremental auto-vacuum; and PostgreSQL's autovacuum, which the adapter already tunes aggressively on the job tables, reclaims dead tuples on its own. Requiring `PRAGMA auto_vacuum = INCREMENTAL` on top of that taxed every database with pointer-map pages and extra write amplification in exchange for file shrinking most deployments never needed.

- `vacuum()` is no longer exposed by `createSqliteStateAdapter()` or `createPgStateAdapter()`; remove the call from cleanup jobs. Space freed by deletions is reused by both engines without it.
- `checkForeignKeys` and `checkAutoVacuum` are no longer accepted; remove them from `createSqliteStateAdapter()` calls.
- `PRAGMA foreign_keys = ON` and `PRAGMA auto_vacuum = INCREMENTAL` are no longer needed on your connections. Blocker-chain integrity is checked by `addJobsBlockers` itself, which raises `ChainNotFoundError` and aborts the transaction.
- To shrink a database file or rewrite a bloated table, run `VACUUM` (PostgreSQL: `VACUUM FULL`) yourself, out of band — both take heavy locks and are not something a cleanup job should do on every pass.
