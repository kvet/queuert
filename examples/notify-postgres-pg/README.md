# PostgreSQL Notify Adapter (pg)

PostgreSQL LISTEN/NOTIFY via `@queuert/postgres` with the pg (node-postgres) client.

## Running

```bash
pnpm install
pnpm --filter example-notify-postgres-pg start
```

Requires Docker (uses testcontainers to start PostgreSQL).
