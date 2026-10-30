---
title: Job & Chain Queries
description: Read-only methods for inspecting jobs, chains and workers.
sidebar:
  order: 14
---

The client provides read-only methods for inspecting chains, jobs and workers. All query methods accept an optional transaction context and don't require `transactionHooks`.

```ts
// Look up a single chain or job by ID
const chain = await client.getChain({ id: chainId });
const job = await client.getJob({ id: jobId });

// Batch lookups — positional array, undefined for missing IDs
const chains = await client.getChains({ ids: [id1, id2, id3] });
const jobs = await client.getJobs({ ids: [id1, id2] });

// Discover which types exist in the data
const chainTypes = await client.listChainTypeNames();
const jobTypes = await client.listJobTypeNames();

// Per-status counts for specific types
const chainCounts = await client.countByChainTypeNames({
  typeNames: ["send-email"],
});
const jobCounts = await client.countByJobTypeNames({
  typeNames: ["send-email"],
});

// Paginated lists with filters
const sendEmailChains = await client.listChains({
  typeName: "send-email",
  status: "running",
  limit: 20,
});
const nextPage = await client.listChains({
  typeName: "send-email",
  status: "running",
  cursor: sendEmailChains.nextCursor ?? undefined,
  limit: 20,
});

const completedJobs = await client.listJobs({
  typeName: "send-email",
  status: "completed",
});

// Jobs within a specific chain, in chain order
const chainJobs = await client.listChainJobs({ chainId });

// Blocker relationships
const blockers = await client.getJobBlockers({ jobId });
const blockedJobs = await client.listBlockedJobs({ chainId });
```

`getChain`, `getChains`, `getJob`, `getJobs`, `getJobBlockers`, and `listBlockedJobs` accept an optional `typeName` for type narrowing (`listChainJobs` takes `chainTypeName`) -- the return type narrows to the specified type. If the entity exists but has a different type, `ChainTypeMismatchError` or `JobTypeMismatchError` is thrown. `listChains` and `listJobs` require `typeName` and filter by it.

See [examples/showcase-queries](https://github.com/kvet/queuert/tree/main/examples/showcase-queries) for a complete working example demonstrating single lookups, paginated lists, chain job listing, and blocker queries. See also [Client API](/queuert/api/core/type-aliases/client/) reference and [Dashboard](/queuert/integrations/dashboard/).

## Ordering

`listChains` and `listJobs` route queries to status-specific indexes based on the `status` and `orderBy` combination. Each status has a natural default sort order — for example, completed chains default to `completedAt` descending, pending and blocked jobs to `scheduledAt` descending. Pass `orderBy: "createdAt"` to override.

## Workers

Each worker an in-process worker starts is a row in the `worker` table: its id, name, the job types it processes, its concurrency, and its lease. The worker reads list the workers that still have a row, which are the live workers plus any whose lease is gone and that were not reclaimed yet. A worker's row is deleted when it stops or when its lease is reclaimed, so no history is kept.

```ts
// Look up workers by ID, undefined for a worker with no row
const worker = await client.getWorker({ id: workerId });
const workers = await client.getWorkers({ ids: [workerId1, workerId2] });

// Every worker, ordered by startedAt, optionally only those processing a type
const allWorkers = await client.listWorkers();
const emailWorkers = await client.listWorkers({ typeName: "send-email" });

// Live workers per job type, in input order
const [liveEmailWorkers] = await client.countWorkersByTypeNames({
  typeNames: ["send-email"],
});

// Every job running under a worker, ordered by attemptAt
const runningJobs = await client.listWorkerJobs({ workerId });
```

A worker whose `leaseUntil` is in the past has lost its lease, and the next reclaim takes its running jobs. `countWorkersByTypeNames` counts only workers whose lease is live. `listWorkerJobs` lists a worker's running jobs whether or not the worker still has a row. Worker type names are plain strings, since a worker in another process may run processors registered against a different job type registry.
