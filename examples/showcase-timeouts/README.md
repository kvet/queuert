# Timeouts Showcase

Timeout patterns for job processing.

Scenarios: cooperative timeout via `AbortController` composed with the job signal; hard timeout via `attemptConfig` for automatic reclamation.

## Running

```bash
bun install
bun run --filter example-showcase-timeouts start
```
