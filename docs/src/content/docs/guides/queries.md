---
title: Job & Chain Queries
description: Read-only methods for inspecting jobs and chains.
sidebar:
  order: 14
---

The client provides read-only methods for inspecting job chains and jobs. All query methods accept an optional transaction context and don't require `transactionHooks`.

```ts
// Look up a single job chain or job by ID
const jobChain = await client.getJobChain({ id: jobChainId });
const job = await client.getJob({ id: jobId });

// Paginated lists with filters
const jobChains = await client.listJobChains({
  filter: { typeName: ["send-email"], status: ["running"] },
  limit: 20,
});

const jobs = await client.listJobs({
  filter: { jobChainId: [jobChainId], status: ["completed"] },
});

// Cursor-based pagination
const nextPage = await client.listJobChains({
  filter: { typeName: ["send-email"] },
  cursor: jobChains.nextCursor,
});

// Jobs within a specific job chain, ordered by chain index
const jobChainJobs = await client.listJobChainJobs({ jobChainId });

// Blocker relationships
const blockers = await client.getJobBlockers({ jobId });
const blockedJobs = await client.listBlockedJobs({ jobChainId });
```

All lookup methods accept an optional `typeName` for type narrowing -- the return type narrows to the specified type. If the entity exists but has a different type, `JobTypeMismatchError` is thrown.

See [examples/showcase-queries](https://github.com/kvet/queuert/tree/main/examples/showcase-queries) for a complete working example demonstrating single lookups, paginated lists, chain job listing, and blocker queries. See also [Client API](/queuert/reference/queuert/client/) reference and [Dashboard](/queuert/integrations/dashboard/).
