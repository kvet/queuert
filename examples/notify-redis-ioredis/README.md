# Redis Notify Adapter (ioredis)

Redis pub/sub notifications via `@queuert/redis` with the ioredis client.

## Running

```bash
pnpm install
pnpm --filter example-notify-redis-ioredis start
```

Requires Docker (uses testcontainers to start Redis).
