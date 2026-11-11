# SQLite State Adapter (better-sqlite3)

SQLite state storage via `@queuert/sqlite` with the better-sqlite3 driver — job creation and completion inside application transactions, with `createAsyncRwLock()` for write serialization: the handler holds the same lock around the transaction it passes to `complete`.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createSqliteMigrator`: a transactional table creation and index, then non-transactional migrations for a backfill in batches and a row-by-row rewrite, through the driver. The non-transactional migrations take the same `createAsyncRwLock()` write lock as the rest of the app around each write.

## Running

```bash
pnpm install
pnpm --filter example-state-sqlite-better-sqlite3 start
```
