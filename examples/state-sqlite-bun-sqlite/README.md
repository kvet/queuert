# SQLite State Adapter (bun:sqlite)

SQLite state storage via `@queuert/sqlite` using Bun's built-in [`bun:sqlite`](https://bun.com/docs/runtime/sqlite) module — no external SQLite dependencies. Its provider is synchronous (marked with `sync: true`), so `createSqliteStateAdapter` returns a sync adapter and `createClient` returns plain values, with job creation and completion inside bun:sqlite's `db.transaction` and no lock.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createSqliteMigrator`: a transactional table creation and index, then non-transactional migrations for a backfill in batches and a row-by-row rewrite, through the driver. They run through the same synchronous provider; the sync migrator takes no lease, so a non-transactional migration is not protected against two processes running it at once.

## Running

```bash
pnpm install
pnpm --filter example-state-sqlite-bun-sqlite start
```

Requires [Bun](https://bun.com).
