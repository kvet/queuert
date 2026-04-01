---
title: Cleanup
description: How to implement automatic cleanup of completed job chains.
sidebar:
  order: 15
---

## Overview

Without cleanup, the job table grows unboundedly as completed chains accumulate. This guide shows how to implement cleanup as a regular Queuert job — listing completed chains older than a cutoff date, deleting them in batches using `continueWith`, and scheduling the next run.

## Define a Cleanup Job Type

```ts
const cleanupJobTypeRegistry = defineJobTypeRegistry<{
  "queuert.cleanup": {
    entry: true;
    input: { cutoffDate?: string; deletedChainCount?: number };
    output: { deletedChainCount: number };
    continueWith: { typeName: "queuert.cleanup" };
  };
}>();
```

The `continueWith` self-reference allows the cleanup job to process chains in batches — each batch completes the current job and continues with the next.

## Write the Processor

```ts
const CLEANUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CLEANUP_BATCH_SIZE = 100;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const cleanupProcessorRegistry = createJobTypeProcessorRegistry({
  client,
  jobTypeRegistry: cleanupJobTypeRegistry,
  processors: {
    "queuert.cleanup": {
      attemptHandler: async ({ job, complete }) =>
        complete(async ({ transactionHooks, continueWith, ...txCtx }) => {
          const cutoffDate = job.input.cutoffDate
            ? new Date(job.input.cutoffDate)
            : new Date(Date.now() - CLEANUP_RETENTION_MS);
          let deletedChainCount = job.input.deletedChainCount ?? 0;

          const page = await client.listJobChains({
            ...txCtx,
            filter: { root: true, to: cutoffDate },
            orderDirection: "asc",
            limit: CLEANUP_BATCH_SIZE,
          });

          const chainsToDelete = page.items.filter(
            (chain) => chain.id !== job.chainId && chain.status === "completed",
          );

          if (chainsToDelete.length > 0) {
            const deleted = await client.deleteJobChains({
              ...txCtx,
              transactionHooks,
              ids: chainsToDelete.map((chain) => chain.id),
            });
            deletedChainCount += deleted.length;
          }

          if (page.nextCursor != null) {
            return continueWith({
              typeName: "queuert.cleanup",
              input: {
                cutoffDate: cutoffDate.toISOString(),
                deletedChainCount,
              },
            });
          }

          await client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "queuert.cleanup",
            input: {},
            deduplication: {
              key: "queuert.cleanup",
              scope: "incomplete",
              excludeJobChainIds: [job.chainId],
            },
            schedule: { afterMs: CLEANUP_INTERVAL_MS },
          });

          return { deletedChainCount };
        }),
    },
  },
});
```

Key patterns used:

- **Retention cutoff** — `CLEANUP_RETENTION_MS` controls how long completed chains are kept before deletion
- **Self-exclusion filter** — the cleanup chain filters itself out of the deletion list to avoid deleting its own chain
- **`continueWith`** — processes chains in bounded batches instead of one unbounded loop
- **`deduplication`** with `scope: "incomplete"` — ensures only one cleanup chain is active at a time
- **`excludeJobChainIds`** — prevents the finishing cleanup chain from deduplicating against itself
- **`schedule`** — defers the next run by `intervalMs`

## Merge and Start

Merge the cleanup registry with your application registries using [slices](/guides/slices/):

```ts
const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypeRegistry: mergeJobTypeRegistries({
    slices: [cleanupJobTypeRegistry, yourJobTypeRegistry],
  }),
});

const worker = await createInProcessWorker({
  client,
  jobTypeProcessorRegistry: mergeJobTypeProcessorRegistries({
    slices: [cleanupProcessorRegistry, yourProcessorRegistry],
  }),
});
```

## Schedule the First Run

Schedule the initial cleanup at application startup. Deduplication makes this idempotent — calling it multiple times returns the same chain:

```ts
await withTransactionHooks(async (transactionHooks) =>
  stateProvider.runInTransaction(async (txCtx) =>
    client.startJobChain({
      ...txCtx,
      transactionHooks,
      typeName: "queuert.cleanup",
      input: {},
      deduplication: { key: "queuert.cleanup", scope: "incomplete" },
    }),
  ),
);
```

After the first run completes, the cleanup job automatically schedules its next run.

## Customization Ideas

Since this is your own job type, you can adapt the logic freely:

- **Per-type retention** — filter by `typeName` and apply different cutoff dates
- **Archive instead of delete** — copy chain data to an archive table before deleting
- **Metrics** — emit the `deletedChainCount` output to your observability system
- **Alerting** — fail the cleanup job if deletion count exceeds a threshold

## See Also

- [Scheduling](/guides/scheduling/) — Deferred start and recurring job patterns
- [Chain Deletion](/guides/chain-deletion/) — Manual chain deletion and blocker safety
- [Slices](/guides/slices/) — Merging job type and processor registries
