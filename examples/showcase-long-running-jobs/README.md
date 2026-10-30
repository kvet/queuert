# Long-Running Jobs Showcase

A report job whose work takes longer than its worker's lease. The work runs outside any transaction and receives `signal`, the worker's heartbeat keeps renewing its lease while it runs, and the handler then writes the report and calls `complete` in its own transaction.

## Running

```bash
pnpm install
pnpm --filter example-showcase-long-running-jobs start
```

Requires Docker (uses testcontainers to start PostgreSQL).
