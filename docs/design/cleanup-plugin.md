# Cleanup Plugin

## Overview

The cleanup plugin removes completed job chains that are older than a configured threshold. It is built on two layers: a standalone batched cleanup utility and a self-scheduling job chain that automates recurring cleanup.

## Motivation

Completed jobs stay in the database indefinitely. Over time this degrades query performance and wastes storage. The cleanup plugin provides automated, recurring removal of stale chains without external cron or manual intervention.

## Usage

```typescript
const cleanup = createCleanupPlugin({
  /* TBD */
});

const client = createClient({ ..., plugins: [cleanup] });
const worker = createInProcessWorker({ ..., plugins: [cleanup] });
```

## Two Layers

### Batched Cleanup Utility

A standalone function that performs one full cleanup pass:

1. Query up to `batchSize` completed chains where `completedAt` is older than the threshold
2. Delete the batch via `deleteJobsByChainIds`
3. Repeat until no matching chains remain
4. Return summary (total chains deleted, total jobs deleted)

This utility is usable independently of the plugin system — it can be called directly for one-off cleanup or from scripts.

**Batching rationale**: Deleting all matching chains in one transaction would hold locks for too long and risk timeouts. Iterating in fixed-size batches keeps each transaction short and predictable.

**Blocker safety**: Only chains where all jobs are `completed` are eligible. The existing blocker safety check in `deleteJobsByChainIds` ensures chains still referenced as blockers by surviving incomplete chains are skipped, not deleted.

### Self-Scheduling Job Chain

The plugin registers job types that form a self-perpetuating cycle:

1. **Batch job** — executes one batch of deletions (up to `batchSize` chains). If more chains remain, continues with another batch job. If no chains remain, the chain completes.
2. After the chain completes, a new chain is scheduled with `scheduledAt` derived from the user-provided scheduling function.

This creates an infinite loop: run cleanup batches → complete → schedule next run → sleep until scheduled time → repeat.

**Why individual batch jobs instead of a loop inside one job?** Each batch is a separate job in the chain (via `continueWith`). This gives visibility into progress through the dashboard, allows the worker to interleave other work between batches, and respects lease timeouts naturally.

## Job Type Names

Plugin job types use the `queuert.cleanup` namespace prefix:

- `queuert.cleanup.batch` — deletes one batch of chains

## Scheduling

The scheduling option is a function that returns a `ScheduleOptions` (`{ at: Date }` or `{ afterMs: number }`), which the plugin uses to set `scheduledAt` on the next cleanup chain. This reuses the existing scheduling primitive rather than introducing cron. The first chain is scheduled during plugin initialization (or on first worker start).

**No external scheduler needed.** The job system itself handles timing via `scheduledAt`. The worker's existing poll/notify loop picks up the job when it becomes eligible.

## Deduplication

The cleanup chain uses `scope: 'incomplete'` deduplication with a fixed key to ensure only one cleanup chain is active or scheduled at a time. If a cleanup chain is already pending or running, starting a new one is a no-op.

## Adapter Hooks

After a cleanup pass completes (all batches done, no chains remaining), the plugin can run adapter-specific maintenance. For example:

- **PostgreSQL**: `VACUUM` or `VACUUM ANALYZE` on the job table to reclaim space and update statistics
- **SQLite**: `PRAGMA optimize` or manual `VACUUM`

These hooks are optional and adapter-dependent. TBD — the mechanism for how the plugin invokes adapter-specific maintenance (callback, adapter method, separate hook interface) is to be defined.

## Configuration

TBD — exact configuration options and their formats to be defined during implementation.

## Considerations

- **Deduplication interaction**: Chains with `scope: 'any'` deduplication rely on completed chains existing in the database for dedup matching. Cleanup of such chains within the dedup `windowMs` could cause duplicates. The cleanup utility should either skip chains with active dedup windows or document this interaction for users to configure `olderThan` accordingly.
- **Dashboard visibility**: Cleanup chains appear in the dashboard like any other chain. The `queuert.cleanup` prefix makes them identifiable and filterable.
- **Metrics**: Cleanup batches emit standard job metrics through the observability adapter. Additional cleanup-specific metrics (chains deleted per pass, pass duration) could be added via the observability hooks.

## See Also

- [Plugins](plugins.md) — Plugin architecture
- [Deletion](deletion.md) — Deletion semantics, blocker safety check
- [Deduplication](deduplication.md) — Dedup interaction with cleanup
