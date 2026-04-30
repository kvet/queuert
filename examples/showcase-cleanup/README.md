# Cleanup Showcase

Automatic cleanup of completed chains implemented as a Queuert job type — batched deletion with cursor pagination, `stateAdapter.vacuum()`, and idempotent rescheduling via deduplication.

## Running

```bash
bun install
bun run --filter example-showcase-cleanup start
```
