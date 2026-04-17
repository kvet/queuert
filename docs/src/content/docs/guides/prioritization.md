---
title: Prioritization
description: Reserve worker capacity for urgent workloads by partitioning job types across workers.
sidebar:
  order: 18
---

Queuert has no built-in `priority` field. Prioritization is a consequence of **partitioning workloads across workers**: each worker owns a subset of job types, and its capacity (concurrency slots) is reserved for those types only. Give an urgent workload its own worker and it can never wait behind a long or slow one.

## Workloads and Capacity

A worker provides a fixed amount of capacity — up to `concurrency` jobs in flight at once. By default, every job type in its processor registry competes for those same slots. If one worker registers every type, a long-running bulk workload can occupy every slot and stall urgent work behind it.

The fix is to run multiple workers, each owning a different subset of job types. Each worker's capacity is reserved for its own workload.

```ts
const jobTypeRegistry = defineJobTypeRegistry<{
  "email.transactional": { entry: true; input: { to: string }; output: { at: number } };
  "email.marketing": { entry: true; input: { to: string }; output: { at: number } };
}>();

const client = await createClient({ stateAdapter, notifyAdapter, jobTypeRegistry });

// Customer-facing workload (password resets, 2FA): reserved capacity.
const transactionalWorker = await createInProcessWorker({
  client,
  workerId: "email-transactional",
  concurrency: 3,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
    client,
    jobTypeRegistry,
    processors: {
      "email.transactional": { attemptHandler: sendTransactionalHandler },
    },
  }),
});

// Bulk workload (digests, newsletters): throttled, won't interfere with the other worker.
const marketingWorker = await createInProcessWorker({
  client,
  workerId: "email-marketing",
  concurrency: 1,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
    client,
    jobTypeRegistry,
    processors: {
      "email.marketing": { attemptHandler: sendMarketingHandler },
    },
  }),
});
```

Each worker's acquisition query filters to its own `typeNames`, so the transactional worker never observes the marketing backlog and picks urgent work up the moment it's enqueued. See [examples/showcase-multiworker-prioritization](https://github.com/kvet/queuert/tree/main/examples/showcase-multiworker-prioritization) for a runnable version.

## Tradeoffs vs. a Shared Pool

Partitioning reserves capacity: a workload with its own worker always has slots available.

The cost is utilization. Idle slots on one worker cannot drain another worker's backlog. If the reserved workload is bursty and rare, its slots sit unused while other work piles up elsewhere. A single worker with adequate concurrency is simpler and has higher utilization — partition only when a specific workload's latency matters enough to justify reserving capacity for it.

Start with one worker. Split when you have evidence that a specific workload is being delayed by others.

## Interactions

### Chains

A chain's `continueWith` can target any job type, so a single chain can start on one worker and continue on another. The handoff happens through the database:

```ts
const jobTypeRegistry = defineJobTypeRegistry<{
  "alert.dispatch": {
    entry: true;
    input: { alertId: string };
    continueWith: { typeName: "alert.archive" };
  };
  "alert.archive": {
    input: { alertId: string };
    output: { archivedAt: number };
  };
}>();
```

With `alert.dispatch` on the urgent worker and `alert.archive` on the bulk worker, the time-sensitive step runs under reserved capacity and the follow-up is deferred to cheaper bulk capacity.

### Blockers

[Blockers](../job-blockers/) are cross-chain, so they work regardless of which worker the blocking chain runs on — a bulk job can block on urgent prerequisites, or the reverse. The job type decides which worker eventually picks up the blocked job once its blockers complete.

### Deduplication

[Deduplication](../deduplication/) keys are scoped by chain type. If you model the same logical work as two separate job types (one per workload), submitting the same key to each will not dedup across them:

```ts
// Two chains — the key is namespaced by typeName, so these don't collide.
await client.startJobChain({ typeName: "sync.transactional", deduplication: { key: "sync:user:42" }, ... });
await client.startJobChain({ typeName: "sync.marketing", deduplication: { key: "sync:user:42" }, ... });
```

Decide which workload a job belongs to before enqueueing, then submit to exactly one type. Don't rely on the dedup key alone to collapse duplicates across workloads.

## One Client vs. Multiple Clients

One `createClient` owns one `jobTypeRegistry`. Two ways to split workloads across workers:

- **One client, multiple workers** — the default. Each worker subsets the shared registry via its own `JobTypeProcessorRegistry`. Use when workloads share the same database and notify adapter.
- **Multiple clients** — one client per workload, each with its own registry, adapters, and connection pool. Reach for this when workloads need different infrastructure: separate connection pools to cap each workload's DB load, different notify channels, or notify adapters that scale independently.

Start with one client. Split only when a concrete resource constraint forces it.

## See Also

- [examples/showcase-multiworker-prioritization](https://github.com/kvet/queuert/tree/main/examples/showcase-multiworker-prioritization) — urgent workload overtaking a bulk backlog; cross-worker chain handoff
- [Horizontal Scaling](../horizontal-scaling/) — worker topologies and when to specialize
- [Feature Slices](../slices/) — organizing job types and processors by domain
