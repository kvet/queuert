# Redis State Adapter (node-redis)

Experimental Redis state storage via `@queuert/redis` with the node-redis client — a chain created in an optimistic transaction, with its side effect in `onTransactionCommit` because the transaction callback may run more than once.

## Running

```bash
pnpm install
pnpm --filter example-state-redis-redis start
```

Requires Docker (uses testcontainers to start Redis).
