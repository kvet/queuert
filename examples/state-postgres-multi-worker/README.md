# PostgreSQL State Adapter (Multi-Worker)

Three worker processes (forked from the main process) share the same PostgreSQL database and compete for jobs — the main process creates orders and their chains in one transaction, and each order is processed by whichever worker acquires its job first.

## Running

```bash
pnpm install
pnpm --filter example-state-postgres-multi-worker start
```

Requires Docker (uses testcontainers to start PostgreSQL).
