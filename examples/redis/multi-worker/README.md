# Redis State Adapter (Multi-Worker)

Three worker processes (forked from the main process) share one Redis instance and compete for jobs — the main process creates a chain per order in one optimistic transaction, and each order is processed by whichever worker claims its job first. The processes wake each other through the Redis notify adapter, so workers pick up new jobs and the main process sees chains complete without waiting for a poll. The notify provider comes from [`postgresql/notify-redis-redis`](../../postgresql/notify-redis-redis), the node-redis notify example.

## Running

```bash
pnpm install
pnpm --filter example-redis-multi-worker start
```

Requires Docker (uses testcontainers to start Redis).
