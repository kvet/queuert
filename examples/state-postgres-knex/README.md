# PostgreSQL State Adapter (Knex)

PostgreSQL state storage via `@queuert/postgres` with Knex — atomic job creation inside application transactions.

Knex's `raw` only binds `?` placeholders and rejects a mismatched binding count, so the provider rewrites the adapter's `$n` placeholders before handing the statement over. See `src/provider.ts`.

## Running

```bash
bun install
bun run --filter example-state-postgres-knex start
```

Requires Docker (uses testcontainers to start PostgreSQL).
