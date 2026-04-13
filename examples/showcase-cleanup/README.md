# Cleanup Showcase

Demonstrates how to implement automatic cleanup of completed job chains as a custom job type using standard Queuert primitives.

## What it shows

1. Defining a cleanup job that deletes completed chains in batches using cursor pagination
2. Reclaiming disk space with `stateAdapter.vacuum()` after deletion
3. Automatically scheduling the next cleanup run
4. Idempotent scheduling with `deduplication` — multiple schedule calls return the same chain

## Key files

- `src/index.ts` - Full cleanup implementation with scenarios: basic cleanup and idempotent scheduling

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-showcase-cleanup start
```
