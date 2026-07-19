# @queuert/typed-sql

Internal helpers shared by the SQL state adapters: typed SQL templates (`sql`/`t`), template appliers (`{{schema}}`, `{{table_prefix}}`, …), and the migration runner described below.

## Migrator

`createMigrator({ migrations, store, lock? })` runs an ordered list of migrations against a `MigrationStore` implemented by each adapter. Every migration has a `type` that controls its execution envelope:

- **`transactional`** — all statements and the migration record commit in a single transaction. The default for schema changes; a failure rolls back cleanly.
- **`non-transactional`** — statements run outside any transaction, one by one. Required for statements that refuse to run inside a transaction (e.g. Postgres `CREATE INDEX CONCURRENTLY`). Statements must be individually idempotent (`IF NOT EXISTS`, guarded `DO` blocks) because a crash between statements leaves the migration half-applied and it will re-run from the first statement.
- **`batched`** — each statement is executed repeatedly via `executeBatchMigrationStatement` until it reports 0 affected rows. Used for large backfills: the statement must update a bounded slice per run (e.g. `WHERE id IN (SELECT … LIMIT n)`) and select only not-yet-migrated rows so it converges and can resume after an interruption.

### Migration locking

When the store provides `acquireMigrationLock` / `extendMigrationLock` / `releaseMigrationLock` (all three, or none — `MigrationStore` intersects a union whose second branch types each method as `?: never`, so a partial set is a compile error and needs no runtime check), `migrateToLatest` serializes across processes with a lease: one process wins the lock and migrates while the others poll; once the winner releases, a waiter re-reads the applied set and skips everything that is already done. The lease is heartbeated while migrating: a heartbeat that finds the lease merely expired (no thief) atomically re-claims it, and the run aborts between migrations — and between non-transactional statements — once another process takes the lease over or heartbeats keep failing past the TTL, so two processes can never interleave migrations. Postgres implements the lease with a single-row `{prefix}migration_lock` table (bootstrapped under an advisory lock); SQLite is exempt — it is single-writer by construction.

## Zero-downtime breaking changes: expand → batch → cut

A breaking schema change (dropping a column, changing how state is represented) cannot be one transactional migration on a live system: the rewrite would hold locks for the whole table, and old-version workers would race the new schema mid-deploy. Split it into phases, each its own migration, ordered so that every intermediate schema is readable by at least one deployed version:

1. **Expand** (`transactional`) — add the new columns, tables, and constraints in their nullable/defaulted form. No data moves; the schema now supports both the old and the new shape, and old workers keep running untouched.
2. **Backfill** (`batched`) — copy or derive the new representation for existing rows in bounded slices. Because each statement re-runs until it affects 0 rows, the drain holds only short row locks, survives restarts, and never blocks concurrent writers. Old workers are still writing old-shape rows behind the drain — that is expected and handled next.
3. **Cut** (`transactional`) — the deliberate breaking point. Under an exclusive table lock, catch up the stragglers minted since the backfill (the same backfill expression, now over a tiny remainder), then drop the old columns and tighten constraints. This migration is what old-version workers cannot survive: after it commits, their statements fail loudly instead of silently corrupting state. Run it only once every deployed worker understands the new schema.
4. **Index build** (`non-transactional`, Postgres) — build the new indexes with `CREATE INDEX CONCURRENTLY` so the finished table is never locked for reads or writes. Keep the statements re-runnable: drop a leftover `INVALID` half-built index before creating, and use `IF NOT EXISTS`.

The migration lock makes this choreography safe to trigger from every app instance on boot: exactly one instance performs the phases, the rest wait and skip.

SQLite collapses the same change into a single `transactional` migration — there is no concurrent old-version writer to protect, and the file is locked for the duration anyway.
