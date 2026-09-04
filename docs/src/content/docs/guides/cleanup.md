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
      attemptHandler: async ({ job, signal, step, complete }) => {
        const cutoffDate = new Date(Date.now() - CLEANUP_RETENTION_MS);
        let deletedChainCount = 0;

        const typeNames = await client.listChainTypeNames();
        let roundDeletedCount: number;

        do {
          roundDeletedCount = 0;

          for (const typeName of typeNames) {
            let cursor: string | undefined;

            do {
              if (signal.aborted) {
                return complete(async ({ finish }) => finish({ reschedule: { afterMs: 0 } }));
              }

              const page = await client.listChains({
                typeName,
                status: "completed",
                orderBy: "completedAt",
                independent: true,
                to: cutoffDate,
                orderDirection: "asc",
                limit: CLEANUP_BATCH_SIZE,
                ...(cursor != null ? { cursor } : {}),
              });

              const chainsToDelete = page.items.filter(
                (chain) => chain.id !== job.chainId && chain.status === "completed",
              );

              if (chainsToDelete.length > 0) {
                const deleted = await step(async ({ transactionHooks, ...txCtx }) =>
                  client.deleteChains({
                    ...txCtx,
                    transactionHooks,
                    ids: chainsToDelete.map((chain) => chain.id),
                  }),
                );
                deletedChainCount += deleted.length;
                roundDeletedCount += deleted.length;
              }

              cursor = page.nextCursor ?? undefined;
            } while (cursor);
          }
        } while (!signal.aborted && roundDeletedCount > 0);

        await stateAdapter.vacuum();

        return complete(async ({ finish, transactionHooks, ...txCtx }) => {
          const completedJob = await finish({ output: null });

          await client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "queuert.cleanup",
            input: null,
            schedule: { afterMs: CLEANUP_INTERVAL_MS },
            deduplication: {
              key: "queuert.cleanup",
              scope: "running",
            },
          });

          return completedJob;
        });
      },
    },
  },
});
```

Key patterns used:

- **Retention cutoff** — `CLEANUP_RETENTION_MS` controls how long completed chains are kept before deletion
- **Per-type iteration** — iterates over all chain type names so each type's completed chains are cleaned up independently
- **Status-filtered listing** — `status: "completed"` with `orderBy: "completedAt"` pushes filtering to the database and orders by completion time, so the oldest-completed chains are deleted first
- **Cursor pagination** — processes chains in bounded batches using `listChains` cursor, preventing unbounded memory usage
- **Stabilization loop** — repeats the full pass until a round deletes zero chains, so chains that become independent after their dependents are removed get cleaned up in subsequent rounds
- **`step` batching** — each batch of deletions runs in its own guarded transaction via `step`, so the handler never holds a single long-lived transaction. The attempt is verified on each `step` call, ensuring the worker still owns the job
- **Graceful shutdown** — checks `signal.aborted` before each batch; when the worker is stopping, reschedules the job immediately so a fresh worker can resume cleanup
- **Vacuum** — reclaims disk space after all deletions complete
- **`deduplication`** with `scope: "running"` — ensures only one cleanup chain is active at a time
- **Complete before scheduling** — `finish({ output: null })` applies the completion inside the complete transaction, so the next run is created against an already-completed chain and does not deduplicate against the one finishing
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
    client.createChain({
      ...txCtx,
      transactionHooks,
      typeName: "queuert.cleanup",
      input: null,
      deduplication: { key: "queuert.cleanup", scope: "running" },
    }),
  ),
);
```

After the first run completes, the cleanup job automatically schedules its next run.

## Reclaiming Disk Space

The cleanup job calls `stateAdapter.vacuum()` after all batches are deleted, reclaiming disk space as part of the cleanup run.

### PostgreSQL

The adapter tunes autovacuum aggressively on the job tables so PostgreSQL handles most space reclamation automatically; the explicit vacuum step ensures timely cleanup after large deletions. See [PostgreSQL Internals](/queuert/advanced/postgres-internals/#vacuum-tuning) for the exact settings.

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
