# PostgreSQL State Adapter (postgres.js)

PostgreSQL state storage via `@queuert/postgres` with postgres.js — job creation and completion inside application transactions.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createPgMigrator`: a transactional table creation, then non-transactional migrations for a concurrent index, a backfill in batches and a row-by-row rewrite, through the driver.

## Running

```bash
pnpm install
pnpm --filter example-state-postgres-postgres-js start
```

Requires Docker (uses testcontainers to start PostgreSQL).
