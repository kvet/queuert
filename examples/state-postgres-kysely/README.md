# PostgreSQL State Adapter (Kysely)

PostgreSQL state storage via `@queuert/postgres` with Kysely — job creation and completion inside application transactions.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createPgMigrator`: a transactional table creation, then non-transactional migrations for a concurrent index, a backfill in batches and a row-by-row rewrite, through the query builder.

## Running

```bash
pnpm install
pnpm --filter example-state-postgres-kysely start
```

Requires Docker (uses testcontainers to start PostgreSQL).
