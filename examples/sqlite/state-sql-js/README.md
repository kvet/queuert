# SQLite state adapter (sql.js)

SQLite state storage via `@queuert/sqlite` with [sql.js](https://sql.js.org), SQLite compiled to WebAssembly running inside the process — job creation and completion inside application transactions, with no native module, so the same provider runs in a browser.

sql.js is a single in-memory database handle with a synchronous API, so the provider and the application share one `createAsyncRwLock()`: a transaction holds its write lock from `BEGIN` to `COMMIT`, and a statement outside a transaction waits for it. Transactions cannot nest, so calling `withTransaction` or a statement outside the transaction from inside its callback deadlocks.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createSqliteMigrator`: a transactional table creation and index, then non-transactional migrations for a backfill in batches and a row-by-row rewrite, through the driver. The non-transactional migrations take the same `createAsyncRwLock()` write lock as the rest of the app around each write.

## Running

```bash
pnpm install
pnpm --filter example-sqlite-state-sql-js start
```
