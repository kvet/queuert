# PostgreSQL State Adapter (Drizzle ORM)

PostgreSQL state storage via `@queuert/postgres` with Drizzle ORM — job creation and completion inside application transactions.

## Running

```bash
bun install
bun run --filter example-state-postgres-drizzle start
```

Requires Docker (uses testcontainers to start PostgreSQL).
