# Redis Notify Adapter (Bun Redis)

Redis pub/sub notifications via `@queuert/redis` using Bun's built-in [`RedisClient`](https://bun.com/docs/runtime/redis) — no external Redis dependencies.

## Running

```bash
pnpm install
pnpm --filter example-notify-redis-bun start
```

Requires [Bun](https://bun.com) and Docker (uses testcontainers to start Redis).
