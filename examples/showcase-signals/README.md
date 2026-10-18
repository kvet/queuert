# Signals Showcase

Abort signal patterns for job processing.

Scenarios: graceful shutdown where the handler stops on `signal` and completes with partial results; external completion via `completeChain` where the running handler stops and the worker discards its attempt.

## Running

```bash
pnpm install
pnpm --filter example-showcase-signals start
```
