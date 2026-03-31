# Cleanup Showcase

Demonstrates how to implement automatic cleanup of completed job chains as a custom job type using standard Queuert primitives.

## What it shows

1. Defining a self-referencing cleanup job type that processes chains in batches via `continueWith`
2. Deleting completed chains older than a cutoff date using `listJobChains` and `deleteJobChains`
3. Automatically scheduling the next cleanup run after all batches are processed
4. Idempotent scheduling with `deduplication` — multiple schedule calls return the same chain

## Key files

- `src/index.ts` - Full cleanup implementation with three scenarios: basic cleanup, batch processing, and idempotent scheduling

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-showcase-cleanup start
```
