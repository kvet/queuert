# Long-Running Jobs Showcase

A report job whose work takes longer than its attempt timeout. The work runs outside any transaction and receives `signal`, the worker's heartbeat keeps extending the attempt's lease while it runs, and the handler then writes the report and calls `finish` in its own transaction.

## Running

```bash
bun install
bun run --filter example-showcase-long-running-jobs start
```

Requires Docker (uses testcontainers to start PostgreSQL).
