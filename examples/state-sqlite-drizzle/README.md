# SQLite State Adapter (Drizzle ORM)

SQLite state storage via `@queuert/sqlite` with Drizzle ORM through a synchronous provider (marked with `sync: true`), so `createSqliteStateAdapter` returns a sync adapter and `createClient` returns plain values — job creation and completion inside Drizzle's synchronous transaction over better-sqlite3, with no lock.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createSqliteMigrator`: a transactional table creation and index, then non-transactional migrations for a backfill in batches and a row-by-row rewrite, through Drizzle. They run through the same synchronous provider; the sync migrator takes no lease, so a non-transactional migration is not protected against two processes running it at once.

## Running

```bash
pnpm install
pnpm --filter example-state-sqlite-drizzle start
```
