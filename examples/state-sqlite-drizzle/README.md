# SQLite State Adapter (Drizzle ORM)

SQLite state storage via `@queuert/sqlite` with Drizzle ORM — job creation and completion inside application transactions, with `createAsyncRwLock()` for write serialization: the handler holds the same lock around the transaction it passes to `complete`.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createSqliteMigrator`: a transactional table creation and index, then non-transactional migrations for a backfill in batches and a row-by-row rewrite, through Drizzle. The non-transactional migrations take the same `createAsyncRwLock()` write lock as the rest of the app around each write.

## Running

```bash
pnpm install
pnpm --filter example-state-sqlite-drizzle start
```
