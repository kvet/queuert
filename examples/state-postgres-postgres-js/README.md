# PostgreSQL State Adapter (postgres.js)

PostgreSQL state storage via `@queuert/postgres` with postgres.js — job creation and completion inside application transactions.

## Running

```bash
pnpm install
pnpm --filter example-state-postgres-postgres-js start
```

Requires Docker (uses testcontainers to start PostgreSQL).
