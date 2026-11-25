# Redis notify adapter (node-redis)

Redis pub/sub notifications via `@queuert/redis` with the node-redis client.

## Running

```bash
pnpm install
pnpm --filter example-postgresql-notify-redis-redis start
```

Requires Docker (uses testcontainers to start Redis).
