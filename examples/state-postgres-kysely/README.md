# PostgreSQL State Adapter (Kysely)

PostgreSQL state storage via `@queuert/postgres` with Kysely — atomic job creation inside application transactions.

## Running

```bash
bun install
bun run --filter example-state-postgres-kysely start
```

Requires Docker (uses testcontainers to start PostgreSQL).
