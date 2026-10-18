# PostgreSQL State Adapter (Bun.SQL)

PostgreSQL state storage via `@queuert/postgres` using Bun's built-in [`SQL`](https://bun.com/docs/runtime/sql) client — atomic job creation inside application transactions, no external PostgreSQL dependencies.

Bun.SQL uses named prepared statements by default. Behind a transaction-mode pooler (PgBouncer, Supavisor), create the client with `new SQL(url, { prepare: false })`.

## Running

```bash
pnpm install
pnpm --filter example-state-postgres-bun-sql start
```

Requires [Bun](https://bun.com) and Docker (uses testcontainers to start PostgreSQL).
