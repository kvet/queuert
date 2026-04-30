# Workerless Completion Showcase

Completing jobs externally without a worker, via `completeChain`.

Scenarios: approval workflow (external API completes the job), deferred start with early completion (scheduled timeout that an early action can preempt).

## Running

```bash
bun install
bun run --filter example-showcase-workerless start
```
