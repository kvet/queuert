# PostgreSQL State Adapter (Multi-Worker)

Multiple workers sharing the same PostgreSQL database for distributed job processing — demonstrates lease-based coordination and fair job distribution across workers.

## Running

```bash
bun install
bun run --filter example-state-postgres-multi-worker start
```

Requires Docker (uses testcontainers to start PostgreSQL).
