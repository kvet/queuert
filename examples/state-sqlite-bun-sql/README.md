# SQLite State Adapter (Bun.SQL)

SQLite state storage via `@queuert/sqlite` using Bun's built-in [`SQL`](https://bun.com/docs/runtime/sql) client in its `sqlite://` mode — no external SQLite dependencies. The handler holds the provider's `createAsyncRwLock()` write lock around the transaction it passes to `complete`.

`Bun.SQL` runs SQLite on a single connection and does not queue transactions on it, so the provider and the application share one `createAsyncRwLock()` to serialize them, the same as with [`bun:sqlite`](../state-sqlite-bun-sqlite).

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createSqliteMigrator`: a transactional table creation and index, then non-transactional migrations for a backfill in batches and a row-by-row rewrite, through the driver. The non-transactional migrations take the same `createAsyncRwLock()` write lock as the rest of the app around each write.

## Running

```bash
pnpm install
pnpm --filter example-state-sqlite-bun-sql start
```

Requires [Bun](https://bun.com).
