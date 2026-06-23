# Signals Showcase

Abort signal patterns for job processing.

Scenarios: graceful shutdown via `worker_stopping` signal reason; external completion via `completeChain` triggering `already_completed` on a running handler.

## Running

```bash
bun install
bun run --filter example-showcase-signals start
```
