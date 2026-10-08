# Timeouts Showcase

Timeout patterns for job processing.

Scenarios: cooperative timeout via `AbortController` composed with the job signal; the attempt lease via `attemptConfig`, which a crashed or stalled worker stops renewing so the job is reclaimed.

## Running

```bash
bun install
bun run --filter example-showcase-timeouts start
```
