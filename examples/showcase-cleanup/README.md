# Cleanup Showcase

Automatic cleanup of completed chains using the built-in `createCleanupJobTypes()` / `createCleanupProcessors()` slices — batched deletion with cursor pagination, self-rescheduling, idempotent startup scheduling via deduplication, and `stateAdapter.vacuum()` to reclaim disk space.

## Running

```bash
bun install
bun run --filter example-showcase-cleanup start
```
