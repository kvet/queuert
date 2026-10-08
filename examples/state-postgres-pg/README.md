# PostgreSQL State Adapter (pg)

PostgreSQL state storage via `@queuert/postgres` with the pg (node-postgres) driver — job creation and completion inside application transactions.

## Running

```bash
bun install
bun run --filter example-state-postgres-pg start
```

Requires Docker (uses testcontainers to start PostgreSQL).
