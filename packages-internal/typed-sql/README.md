# @queuert/typed-sql

Internal helpers shared by the SQL state adapters: typed SQL templates (`sql`/`t`), template appliers (`{{schema}}`, `{{table_prefix}}`, …), and the migration runner described below.

## Migrator

`createMigrator({ migrations, store, lock?, before?, after? })` runs an ordered list of migrations against a `MigrationStore` implemented by each adapter. Migration names are `NNN_snake_case` (`001_initial_schema`) and must sort ascending. Every migration has a `type` that controls its execution envelope:

- **`transactional`** — all statements and the migration record commit in a single transaction. The default for schema changes; a failure rolls back cleanly.
- **`non-transactional`** — statements run outside any transaction, one by one. Required for statements that refuse to run inside a transaction (e.g. Postgres `CREATE INDEX CONCURRENTLY`). Statements must be individually idempotent (`IF NOT EXISTS`, guarded `DO` blocks) because a crash between statements leaves the migration half-applied and it will re-run from the first statement.
- **`batched`** — each statement is executed repeatedly via `executeBatchMigrationStatement` until it reports 0 affected rows. Used for large backfills: the statement must update a bounded slice per run (e.g. `WHERE id IN (SELECT … LIMIT n)`) and select only not-yet-migrated rows so it converges and can resume after an interruption.

### Migration locking

When the store provides `acquireMigrationLock` / `extendMigrationLock` / `releaseMigrationLock` (all three, or none — `MigrationStore` intersects a union whose second branch types each method as `?: never`, so a partial set is a compile error and needs no runtime check), `migrateToLatest` serializes across processes with a lease: one process wins the lock and migrates while the others poll; once the winner releases, a waiter re-reads the applied set and skips everything that is already done. The lease is heartbeated while migrating: a heartbeat that finds the lease merely expired (no thief) atomically re-claims it, and the run aborts between migrations — and between non-transactional statements — once another process takes the lease over or heartbeats keep failing past the TTL, so two processes can never interleave migrations. Postgres implements the lease with a single-row `{prefix}migration_lock` table (bootstrapped under an advisory lock); SQLite is exempt — it is single-writer by construction.

### Scripts around the run

`before` and `after` are JavaScript (`MigrationScript`), not migrations: they run under the same lease, but nothing is recorded for them, so they execute on **every** `migrateToLatest()` and must probe the state they are about to change and return early when there is nothing to do.

A script reaches the database through its own adapter — the provider and template applier it was built with — not through the migrator, so its queries stay as typed as every other query the adapter runs. The only thing it takes from the run is its single argument, `assertLockHeld`, which throws once the lease is lost; call it before every batch of a long one.

`before` runs ahead of the applied-set read, so it may rewrite the migration table itself; `after` runs behind the last pending migration. They exist for work the migration list cannot own — carrying a schema that predates the list onto it, for instance — and keep that work out of the lineage the adapter declares.

## Choosing a migration shape

### Zero-downtime changes: expand → batch → cut

A change that must not interrupt a running system (adding a representation, tightening a constraint) is split into phases, each its own migration, ordered so that every intermediate schema is readable by at least one deployed version:

1. **Expand** (`transactional`) — add the new columns, tables, and constraints in their nullable/defaulted form. No data moves; the schema now supports both the old and the new shape, and old workers keep running untouched.
2. **Backfill** (`batched`) — copy or derive the new representation for existing rows in bounded slices. Because each statement re-runs until it affects 0 rows, the drain holds only short row locks, survives restarts, and never blocks concurrent writers. Old workers are still writing old-shape rows behind the drain — that is expected and handled next.
3. **Cut** (`transactional`) — the deliberate breaking point. Under an exclusive table lock, catch up the stragglers minted since the backfill (the same backfill expression, now over a tiny remainder), then drop the old columns and tighten constraints. This migration is what old-version workers cannot survive: after it commits, their statements fail loudly instead of silently corrupting state. Run it only once every deployed worker understands the new schema.
4. **Index build** (`non-transactional`, Postgres) — build the new indexes with `CREATE INDEX CONCURRENTLY` so the finished table is never locked for reads or writes. Keep the statements re-runnable: drop a leftover `INVALID` half-built index before creating, and use `IF NOT EXISTS`.

The migration lock makes this choreography safe to trigger from every app instance on boot: exactly one instance performs the phases, the rest wait and skip.

### Wholesale reshaping: rename aside and import

When the target shape is far enough from the old one that expand → cut would be a long chain of `ALTER`s — or when data has to move _between_ rows rather than between columns of the same row — do not extend the lineage at all. Move the old schema out of the way, let the migrations install the new one from scratch, and copy the rows across. The adapters use this shape, with the two halves as `before` and `after` scripts in a file of their own:

1. **`before`** — probe for the renamed-aside tables (already prepared → return), then for the live tables (absent → a fresh install, return), then for a column only the old shape has (absent → nothing to upgrade, return). Read the migration table for the oldest schema the import can read and throw a directed error if it is missing. Then rename the live tables to `_old` and delete the old migration records, so the migrator behind it reads an empty ledger and performs a plain install. Renaming a table renames neither its indexes nor its constraints, and both namespaces are schema-wide, so every name the new schema will claim has to be renamed or dropped here — otherwise Postgres silently suffixes the new one and an upgraded database ends up with different constraint names than a fresh install.
2. **The migrations** — `001_initial_schema` and whatever has been added since. Fresh installs and upgrades run exactly the same statements; there is one description of the schema, not two.
3. **`after`** — copy the `_old` tables into the new ones in batches, verify the row counts, then drop them. Keep the row transform in SQL (`INSERT … SELECT`) and let JavaScript own only the batching: reading rows into JavaScript and writing them back loses precision the driver does not model, such as sub-millisecond timestamps.

Two invariants make the import restartable. Batch by **whole chains, one statement per batch**: a self-referential foreign key can point forward as well as backward, and no row order satisfies both — but both engines check immediate foreign keys at statement end, by which point the chain is complete. And key the batches on an **ascending id watermark** read back from the destination table, so the resume point after a crash is `SELECT … ORDER BY <key> DESC LIMIT 1` and needs no progress bookkeeping. Call `assertLockHeld()` at the top of each batch so a stolen lease aborts the run instead of racing the thief.

This is **not** zero-downtime: the live tables are gone for the length of the import, and old-version workers fail while it runs. Prefer expand → cut whenever the change can be expressed that way. Its compensation is that the lineage never accumulates: when the old version leaves support, the scripts and their file are deleted and the adapter is untouched.

SQLite collapses phased changes into a single `transactional` migration where it can — there is no concurrent old-version writer to protect, and the file is locked for the duration anyway.
