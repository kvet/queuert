---
title: Job & Chain Queries
description: Read-only methods for inspecting jobs and chains.
sidebar:
  order: 14
---

The client provides read methods for inspecting chains and jobs. Most are plain lookups — they accept an optional transaction context and never require `transactionHooks`. A few (`getChain`, `getChains`, `getJob`, `getJobs`) also take an opt-in `lock: true` that turns the read into the first, gated half of a race-free read-modify-write — see [Locked reads](#locked-reads) below.

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

See [examples/showcase-queries](https://github.com/kvet/queuert/tree/main/examples/showcase-queries) for a complete working example demonstrating single lookups, paginated lists, chain job listing, and blocker queries. See also [Client API](/queuert/api/core/type-aliases/client/) reference and [Dashboard](/queuert/integrations/dashboard/).

## Locked reads

`getChain`, `getChains`, `getJob`, and `getJobs` accept an opt-in `lock: true` that holds a write-intent lock on every matched row until the enclosing transaction ends (PostgreSQL `SELECT ... FOR UPDATE`; SQLite promotes to the write lock; the in-process adapter serializes the transaction). Use it for a race-free read-modify-write: read the row, decide, then write, with no other transaction able to update or delete it in between.

Because the lock is scoped to a transaction, `lock: true` **requires** a transaction context — the parameter is a discriminated union, so `{ lock: true }` without one fails to compile.

A row lock only covers rows that exist: a lookup that matches nothing locks nothing, so `lock` does not serialize a "create if absent" against a concurrent create. Close that race with `createChain` deduplication instead; the two mechanisms compose.

See [examples/showcase-scheduling](https://github.com/kvet/queuert/tree/main/examples/showcase-scheduling) for a runnable version of this pattern — a locked read that confirms a job is still pending before rescheduling it to run early.

## Ordering

`listChains` and `listJobs` route queries to status-specific indexes based on the `status` and `orderBy` combination. Each status has a natural default sort order — for example, completed chains default to `completedAt` descending, pending jobs to `scheduledAt` descending. Pass `orderBy: "createdAt"` to override.
