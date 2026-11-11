# SQLite State Adapter (bun:sqlite)

SQLite state storage via `@queuert/sqlite` using Bun's built-in [`bun:sqlite`](https://bun.com/docs/runtime/sqlite) module — no external SQLite dependencies. The handler holds the provider's `createAsyncRwLock()` write lock around the transaction it passes to `complete`.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createSqliteMigrator`: a transactional table creation and index, then non-transactional migrations for a backfill in batches and a row-by-row rewrite, through the driver. The non-transactional migrations take the same `createAsyncRwLock()` write lock as the rest of the app around each write.

## Running

```bash
pnpm install
pnpm --filter example-state-sqlite-bun-sqlite start
```

Requires [Bun](https://bun.com).
