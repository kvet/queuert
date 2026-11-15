# MySQL State Adapter (Multi-Worker)

Three worker processes (forked from the main process) share the same MySQL database and compete for jobs — the main process creates orders and their chains in one transaction, and each order is processed by whichever worker acquires its job first. MySQL has no notify adapter, so the workers poll for new jobs every 500 ms through `pollIntervalMs` and the main process polls for finished chains at the same interval.

## Running

```bash
pnpm install
pnpm --filter example-mysql-multi-worker start
```

Requires Docker (uses testcontainers to start MySQL).
