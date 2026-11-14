# SQLite State Adapter (better-sqlite3)

SQLite state storage via `@queuert/sqlite` with the better-sqlite3 driver through a synchronous provider (marked with `sync: true`), so `createSqliteStateAdapter` returns a sync adapter and `createClient` returns plain values — job creation and completion inside better-sqlite3's own `db.transaction`, with no lock.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createSqliteMigrator`: a transactional table creation and index, then non-transactional migrations for a backfill in batches and a row-by-row rewrite, through the driver. They run through the same synchronous provider; the sync migrator takes no lease, so a non-transactional migration is not protected against two processes running it at once.

## Running

```bash
pnpm install
pnpm --filter example-state-sqlite-better-sqlite3 start
```
