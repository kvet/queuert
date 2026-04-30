---
title: Cleanup
description: How to implement automatic cleanup of completed chains.
sidebar:
  order: 15
---

## Overview

Without cleanup, the job table grows unboundedly as completed chains accumulate. This guide shows how to implement cleanup as a regular Queuert job — listing completed chains older than a cutoff date, deleting them in batches using cursor pagination, reclaiming disk space with vacuum, and scheduling the next run.

## Define a Cleanup Job Type

```ts
const cleanupJobTypes = defineJobTypes<{
  "queuert.cleanup": {
    entry: true;
    input: null;
    output: null;
  };
}>();
```

## Write the Processor

```ts
const CLEANUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CLEANUP_BATCH_SIZE = 100;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const cleanupProcessorRegistry = createProcessors({
  client,
  jobTypes: cleanupJobTypes,
  processors: {
    "queuert.cleanup": {
      attemptHandler: async ({ job, complete }) => {
        const cutoffDate = new Date(Date.now() - CLEANUP_RETENTION_MS);
        let deletedChainCount = 0;
        let cursor: string | undefined;

        do {
          const page = await client.listChains({
            filter: { root: true, to: cutoffDate },
            orderDirection: "asc",
            limit: CLEANUP_BATCH_SIZE,
            ...(cursor != null ? { cursor } : {}),
          });

          const chainsToDelete = page.items.filter(
            (chain) => chain.id !== job.chainId && chain.status === "completed",
          );

          if (chainsToDelete.length > 0) {
            const deleted = await withTransactionHooks(async (transactionHooks) =>
              stateProvider.withTransaction(async (txCtx) =>
                client.deleteChains({
                  ...txCtx,
                  transactionHooks,
                  ids: chainsToDelete.map((chain) => chain.id),
                }),
              ),
            );
            deletedChainCount += deleted.length;
          }

          cursor = page.nextCursor ?? undefined;
        } while (cursor);

        await stateAdapter.vacuum();

        return complete(async ({ transactionHooks, ...txCtx }) => {
          await client.startChain({
            ...txCtx,
            transactionHooks,
            typeName: "queuert.cleanup",
            input: null,
            schedule: { afterMs: CLEANUP_INTERVAL_MS },
            deduplication: {
              key: "queuert.cleanup",
              scope: "incomplete",
              excludeChainIds: [job.chainId],
            },
          });

          return null;
        });
      },
    },
  },
});
```

Key patterns used:

- **Retention cutoff** — `CLEANUP_RETENTION_MS` controls how long completed chains are kept before deletion
- **Self-exclusion filter** — the cleanup chain filters itself out of the deletion list to avoid deleting its own chain
- **Cursor pagination** — processes chains in bounded batches using `listChains` cursor, preventing unbounded memory usage
- **Vacuum** — reclaims disk space after all deletions complete
- **`deduplication`** with `scope: "incomplete"` — ensures only one cleanup chain is active at a time
- **`excludeChainIds`** — prevents the finishing cleanup chain from deduplicating against itself
- **`schedule`** — defers the next run by `CLEANUP_INTERVAL_MS`

## Merge and Start

Compose the cleanup slice with your application slices by passing arrays to `createClient` and `createInProcessWorker`:

```ts
const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes: [cleanupJobTypes, yourJobTypes],
});

const worker = await createInProcessWorker({
  client,
  processors: [cleanupProcessorRegistry, yourProcessorRegistry],
});
```

## Schedule the First Run

Schedule the initial cleanup at application startup. Deduplication makes this idempotent — calling it multiple times returns the same chain:

```ts
await withTransactionHooks(async (transactionHooks) =>
  stateProvider.withTransaction(async (txCtx) =>
    client.startChain({
      ...txCtx,
      transactionHooks,
      typeName: "queuert.cleanup",
      input: null,
      deduplication: { key: "queuert.cleanup", scope: "incomplete" },
    }),
  ),
);
```

After the first run completes, the cleanup job automatically schedules its next run.

## Reclaiming Disk Space

The cleanup job calls `stateAdapter.vacuum()` after all batches are deleted, reclaiming disk space as part of the cleanup run.

### PostgreSQL

The adapter configures aggressive autovacuum on the job tables (2% dead-tuple threshold, no I/O throttle) and sets `fillfactor = 75` on the job table to enable HOT updates. PostgreSQL's autovacuum handles most space reclamation automatically, but the explicit vacuum step ensures timely cleanup after large deletions. See [PostgreSQL Internals](/queuert/advanced/postgres-internals/#vacuum-tuning) for details.

### SQLite

SQLite does not reclaim space automatically. The vacuum step frees reclaimable pages via incremental vacuum. This requires `PRAGMA auto_vacuum = INCREMENTAL` to be set on the database before table creation. See [SQLite Internals](/queuert/advanced/sqlite-internals/#vacuum) for details.

## Customization Ideas

Since this is your own job type, you can adapt the logic freely:

- **Per-type retention** — filter by `typeName` and apply different cutoff dates
- **Archive instead of delete** — copy chain data to an archive table before deleting
- **Metrics** — emit the `deletedChainCount` to your observability system
- **Alerting** — fail the cleanup job if deletion count exceeds a threshold

See [examples/showcase-cleanup](https://github.com/kvet/queuert/tree/main/examples/showcase-cleanup) for a complete working example demonstrating automatic cleanup of completed chains.

## See Also

- [Scheduling](/queuert/guides/scheduling/) — Deferred start and recurring job patterns
- [Chain Deletion](/queuert/guides/chain-deletion/) — Manual chain deletion and blocker safety
- [Slices](/queuert/guides/slices/) — Merging job type and processor registries
