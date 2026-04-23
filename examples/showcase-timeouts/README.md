# Timeouts Showcase

Timeout patterns for job processing.

Scenarios: cooperative timeout via `AbortSignal.timeout()` composed with the job signal; hard timeout via `leaseConfig` for automatic reclamation.

## Running

```bash
bun install
bun run --filter example-showcase-timeouts start
```
