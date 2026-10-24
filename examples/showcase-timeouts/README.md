# Timeouts Showcase

Timeout patterns for job processing.

Scenarios: cooperative timeout via `AbortController` composed with the job signal; the attempt timeout via `attemptConfig`, which a crashed or stalled worker stops extending so the job is reclaimed.

## Running

```bash
pnpm install
pnpm --filter example-showcase-timeouts start
```

Requires Docker (uses testcontainers to start PostgreSQL).
