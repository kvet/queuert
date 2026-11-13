---
title: Job, Chain & Worker Queries
description: Read-only methods for inspecting jobs, chains and workers.
sidebar:
  order: 14
---

The client provides read-only methods for inspecting chains, jobs and workers. All query methods accept an optional transaction context in which every field is optional, so a read needs only the transaction handle, not the `txHooks` some providers carry in their context.

```ts
// Look up a single chain or job by ID
const chain = await client.getChain({ id: chainId });
const job = await client.getJob({ id: jobId });

// Batch lookups — positional array, undefined for missing IDs
const chains = await client.getChains({ ids: [id1, id2, id3] });
const jobs = await client.getJobs({ ids: [id1, id2] });

// Discover which types exist in the data
const chainTypes = await client.getChainTypeNames();
const jobTypes = await client.getJobTypeNames();

// Per-status counts for specific types
const chainCounts = await client.countChainsByTypeName({
  typeNames: ["send-email"],
});
const jobCounts = await client.countJobsByTypeName({
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

`getChain`, `getChains`, `getJob`, `getJobs`, `getJobBlockers`, and `listBlockedJobs` accept an optional `typeName` for type narrowing (`listChainJobs` takes `chainTypeName`) — the return type narrows to the specified type. If the entity exists but has a different type, `ChainTypeMismatchError` or `JobTypeMismatchError` is thrown. `listChains` and `listJobs` require `typeName` and filter by it.

## Workers

```ts
// Look up workers by ID, undefined for a worker with no row
const worker = await client.getWorker({ id: workerId });
const workers = await client.getWorkers({ ids: [workerId1, workerId2] });

// Live and expired workers, overall and per job type, and jobs running under each worker
const { live, expired } = await client.countWorkers();
const [emailWorkers] = await client.countWorkersByTypeName({
  typeNames: ["send-email"],
});
const [runningJobCount] = await client.countRunningJobsByWorkerId({ workerIds: [workerId] });

// Workers ordered by startedAt, optionally only those processing a type
const page = await client.listWorkers({ limit: 20 });
const nextPage = await client.listWorkers({ limit: 20, cursor: page.nextCursor! });
const emailWorkerPage = await client.listWorkers({ typeName: "send-email" });

// Jobs running under a worker, ordered by attemptAt
const runningJobs = await client.listWorkerJobs({ workerId });
```

## Ordering

`listChains` and `listJobs` route queries to status-specific indexes based on the `status` and `orderBy` combination. Each status has a natural default sort order — for example, completed chains default to `completedAt` descending, pending and blocked jobs to `scheduledAt` descending. Pass `orderBy: "createdAt"` to override. `listWorkers` and `listWorkerJobs` take no `orderBy`: they sort by `startedAt` and `attemptAt`, then id, ascending unless `orderDirection` says otherwise.

## See Also

See [examples/showcase-queries](https://github.com/kvet/queuert/tree/main/examples/showcase-queries) for a complete working example demonstrating single lookups, paginated lists, chain job listing, blocker queries, and worker queries. See also [Client API](/queuert/api/core/type-aliases/client/) reference and [Dashboard](/queuert/integrations/dashboard/).
