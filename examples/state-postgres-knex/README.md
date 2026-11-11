# PostgreSQL State Adapter (Knex)

PostgreSQL state storage via `@queuert/postgres` with Knex — job creation and completion inside application transactions.

Knex's `raw` only binds `?` placeholders and rejects a mismatched binding count, so the provider rewrites the adapter's `$n` placeholders before handing the statement over. See `src/provider.ts`.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createPgMigrator`: a transactional table creation, then non-transactional migrations for a concurrent index, a backfill in batches and a row-by-row rewrite, through the query builder.

## Running

```bash
pnpm install
pnpm --filter example-state-postgres-knex start
```

Requires Docker (uses testcontainers to start PostgreSQL).
