# PostgreSQL State Adapter (Kysely)

PostgreSQL state storage via `@queuert/postgres` with Kysely — job creation and completion inside application transactions.

## Running

```bash
pnpm install
pnpm --filter example-state-postgres-kysely start
```

Requires Docker (uses testcontainers to start PostgreSQL).
