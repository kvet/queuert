# Timeouts Showcase

Timeout patterns for job processing.

Scenarios: cooperative timeout via `AbortController` composed with the job signal; the worker `lease`, which a crashed or stalled worker stops renewing so its jobs are reclaimed.

## Running

```bash
pnpm install
pnpm --filter example-showcase-timeouts start
```

Requires Docker (uses testcontainers to start PostgreSQL).
