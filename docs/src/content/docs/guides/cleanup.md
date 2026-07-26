---
title: Cleanup
description: How to implement automatic cleanup of completed chains.
sidebar:
  order: 15
---

## Overview

Without cleanup, the job table grows unboundedly as completed chains accumulate. Queuert ships a built-in cleanup job — a job type and a processor you mount alongside your own — that deletes completed chains older than a retention cutoff in batches and reschedules itself. You schedule the first run and choose the retention and interval; everything else is handled for you.

## Mount the Built-In

`createCleanupJobTypes()` and `createCleanupProcessors()` return regular slices, so they compose with your own via the array merge pattern:

```ts
import {
  createCleanupJobTypes,
  createCleanupProcessors,
  createClient,
  createInProcessWorker,
} from "queuert";

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes: [createCleanupJobTypes(), yourJobTypes],
});

const worker = await createInProcessWorker({
  client,
  processors: [createCleanupProcessors({ client }), yourProcessorRegistry],
});
```

The job type is named `__queuert/cleanup`. Its input carries both knobs:

- **`retentionMs`** — completed chains that finished longer ago than this are deleted
- **`intervalMs`** — how long to wait before the next run

`createCleanupProcessors` also accepts:

- **`batchSize`** — chains listed and deleted per batch (defaults to 100)
- **`attemptMiddleware`** — the middleware chain for this slice. Pass the same instances here that you pass to the worker's `requiredAttemptMiddleware`, which matches by reference identity.

Since the built-in is just another slice, you can mount it on a dedicated worker to keep deletion off your hot processing path.

## Schedule the First Run

Schedule the initial cleanup at application startup. Deduplication makes this idempotent — calling it on every boot returns the same chain:

```ts
await withTransactionHooks(async (transactionHooks) =>
  stateProvider.withTransaction(async (txCtx) =>
    client.createChain({
      ...txCtx,
      transactionHooks,
      typeName: "__queuert/cleanup",
      input: {
        retentionMs: 7 * 24 * 60 * 60 * 1000, // keep completed chains for 7 days
        intervalMs: 60 * 60 * 1000, // run hourly
      },
      deduplication: { key: "__queuert/cleanup", scope: "running" },
    }),
  ),
);
```

Each run starts the next one as a new independent chain, forwarding the same input, so retention and interval persist without further involvement from you. To change either, let the current chain finish and schedule a new one with the new input, or delete the pending chain and re-create it.

## What the Handler Does

- **Retention cutoff** — lists completed chains whose `completedAt` predates `now - retentionMs`
- **Status-filtered listing** — `status: "completed"` with `orderBy: "completedAt"` pushes filtering to the database and deletes oldest-completed first
- **Cursor pagination** — processes chains in bounded batches, so memory stays flat regardless of backlog size
- **`execute` batching** — each batch of deletions runs in its own guarded transaction, so the handler never holds a single long-lived transaction, and the attempt is verified on every batch
- **Self-exclusion** — the running cleanup chain is never deleted by its own run
- **Cooperative shutdown** — the scan drops out between batches when the worker is stopping; deletion is idempotent and the next run resumes from the oldest remaining chain
- **Rescheduling** — a new cleanup chain is created inside the completion transaction, deduplicated on `scope: "running"` with the current chain excluded

## Reclaiming Disk Space

Deleting rows does not necessarily return disk to the operating system. The built-in handler does not vacuum, because `vacuum()` lives on the concrete state adapters rather than the shared `StateAdapter` interface. Call it yourself on whatever cadence suits your deployment:

```ts
await stateAdapter.vacuum();
```

### PostgreSQL

The adapter tunes autovacuum aggressively on the job tables so PostgreSQL handles most space reclamation automatically; an explicit vacuum ensures timely cleanup after large deletions. See [PostgreSQL Internals](/queuert/advanced/postgres-internals/#vacuum-tuning) for the exact settings.

### SQLite

SQLite does not reclaim space automatically. `vacuum()` frees reclaimable pages via incremental vacuum. This requires `PRAGMA auto_vacuum = INCREMENTAL` to be set on the database before table creation. See [SQLite Internals](/queuert/advanced/sqlite-internals/#vacuum) for details.

## Writing Your Own

The built-in deletes _all_ completed chains past the cutoff — there is no per-type filter. If you need more, write your own job type and processor with the same shape; the built-in's behavior above is the specification to start from:

- **Per-type retention** — filter `listChains` by `typeName` and apply different cutoff dates
- **Archive instead of delete** — copy chain data to an archive table before deleting
- **Metrics** — emit the deleted-chain count to your observability system
- **Alerting** — fail the cleanup job if the deletion count exceeds a threshold

See [examples/showcase-cleanup](https://github.com/kvet/queuert/tree/main/examples/showcase-cleanup) for a complete working example.

## See Also

- [Scheduling](/queuert/guides/scheduling/) — Deferred start and recurring job patterns
- [Chain Deletion](/queuert/guides/chain-deletion/) — Manual chain deletion and blocker safety
- [Slices](/queuert/guides/slices/) — Merging job type and processor registries
