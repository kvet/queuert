---
"@queuert/postgres": minor
"@queuert/sqlite": minor
---

The migrator that runs Queuert's own schema is exported, experimentally, for your application's migrations: `createPgMigrator` and `createSqliteMigrator` keep the history in tables you name, run through your state provider, and let many processes migrate on boot at once ([#8](https://github.com/kvet/queuert/issues/8)). Migrations run in list order and can be reverted; each is an `up` and a `down` function that uses your own query builder inside the migration's transaction, or runs outside a transaction when the migration sets `type: "non-transactional"`.

- New exports: `createPgMigrator` / `createSqliteMigrator` and the `Migration`, `MigrationScript` and `Migrator` types.
- `down` is required: `migrateTo` uses it to revert, and a migration that cannot be reverted throws from it. `migrateTo(null)` reverts every applied migration.
- Invalid lease timings throw a `TypeError` when the migrator is created; `heartbeatIntervalMs` must be below a third of `ttlMs`.
- `MigrationResult` gains `reverted`.
- A failing migration rejects with an error naming it, with the original error as `cause`.
- With PostgreSQL, the state adapter's `migrateToLatest` no longer issues `CREATE TABLE IF NOT EXISTS` for its history and lease tables once they exist, so a boot against a migrated database logs no server notices, and a process can take over an expired lease while another process's migration transaction is still open.
- `@queuert/postgres/conformance` and `@queuert/sqlite/conformance` export migrator conformance cases to run over your state provider.
