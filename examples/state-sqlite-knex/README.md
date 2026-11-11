# SQLite State Adapter (Knex)

SQLite state storage via `@queuert/sqlite` with Knex — job creation and completion inside application transactions. Knex's better-sqlite3 dialect uses a size-1 connection pool that already serializes writers, so no external lock is needed, for client calls or for the transaction a handler passes to `complete`.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createSqliteMigrator`: a transactional table creation and index, then non-transactional migrations for a backfill in batches and a row-by-row rewrite, through the query builder. Transactional migrations query only through `txCtx`, because the outer client would wait on the single connection the migration holds.

## Running

```bash
pnpm install
pnpm --filter example-state-sqlite-knex start
```
