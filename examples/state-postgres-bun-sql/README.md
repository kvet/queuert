# PostgreSQL State Adapter (Bun.SQL)

PostgreSQL state storage via `@queuert/postgres` using Bun's built-in [`SQL`](https://bun.com/docs/runtime/sql) client — job creation and completion inside application transactions, no external PostgreSQL dependencies.

Bun.SQL uses named prepared statements by default. Behind a transaction-mode pooler (PgBouncer, Supavisor), create the client with `new SQL(url, { prepare: false })`.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createPgMigrator`: a transactional table creation, then non-transactional migrations for a concurrent index, a backfill in batches and a row-by-row rewrite, through the driver.

## Running

```bash
pnpm install
pnpm --filter example-state-postgres-bun-sql start
```

Requires [Bun](https://bun.com) and Docker (uses testcontainers to start PostgreSQL).
