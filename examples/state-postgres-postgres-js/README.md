# PostgreSQL State Adapter (postgres.js)

PostgreSQL state storage via `@queuert/postgres` with postgres.js — atomic job creation inside application transactions.

## Running

```bash
bun install
bun run --filter example-state-postgres-postgres-js start
```

Requires Docker (uses testcontainers to start PostgreSQL).
