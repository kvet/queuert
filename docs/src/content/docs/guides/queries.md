---
title: Job & Chain Queries
description: Read-only methods for inspecting jobs and chains.
sidebar:
  order: 14
---

The client provides read-only methods for inspecting chains and jobs. All query methods accept an optional transaction context and don't require `transactionHooks`.

```ts
// Look up a single chain or job by ID
const chain = await client.getChain({ id: chainId });
const job = await client.getJob({ id: jobId });

// Batch lookups — positional array, undefined for missing IDs
const batch = await client.getChains({ ids: [id1, id2, id3] });
const batchJobs = await client.getJobs({ ids: [id1, id2] });

// Paginated lists with filters
const chains = await client.listChains({
  typeName: ["send-email"],
  status: "running",
  limit: 20,
});

const jobs = await client.listJobs({
  chainId: [chainId],
  status: "completed",
});

// Cursor-based pagination
const nextPage = await client.listChains({
  typeName: ["send-email"],
  cursor: chains.nextCursor,
});

// Jobs within a specific chain, in chain order
const chainJobs = await client.listChainJobs({ chainId });

// Blocker relationships
const blockers = await client.getJobBlockers({ jobId });
const blockedJobs = await client.listBlockedJobs({ chainId });
```

All lookup methods accept an optional `typeName` for type narrowing -- the return type narrows to the specified type. If the entity exists but has a different type, `ChainTypeMismatchError` or `JobTypeMismatchError` is thrown.

See [examples/showcase-queries](https://github.com/kvet/queuert/tree/main/examples/showcase-queries) for a complete working example demonstrating single lookups, paginated lists, chain job listing, and blocker queries. See also [Client API](/queuert/reference/queuert/client/) reference and [Dashboard](/queuert/integrations/dashboard/).

## Ordering

`listChains` and `listJobs` route queries to status-specific indexes based on the `status` and `orderBy` combination. Each status has a natural default sort order — for example, completed chains default to `completedAt` descending, pending jobs to `scheduledAt` descending. Pass `orderBy: "createdAt"` to override.
