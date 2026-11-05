# Timeouts Showcase

Timeout patterns for job processing.

Scenarios: cooperative timeout via `AbortController` composed with the job signal; a job that outlasts the worker lease (`leaseConfig`) and completes while the heartbeat renews it.

## Running

```bash
pnpm install
pnpm --filter example-showcase-timeouts start
```

Requires Docker (uses testcontainers to start PostgreSQL).
