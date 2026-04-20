---
title: Client
description: Client API and transaction hooks for the queuert core package.
sidebar:
  order: 1
---

## createClient

```typescript
const client = await createClient({
  stateAdapter: StateAdapter,
  notifyAdapter?: NotifyAdapter,
  observabilityAdapter?: ObservabilityAdapter,
  jobTypeRegistry: JobTypeRegistry,
  log?: Log,
});
```

Returns `Promise<Client>`.

- **stateAdapter** — database adapter for job persistence
- **notifyAdapter** — optional pub/sub adapter for real-time notifications between client and workers
- **observabilityAdapter** — optional adapter for metrics and tracing
- **jobTypeRegistry** — job type registry created by `defineJobTypeRegistry()` or `createJobTypeRegistry()`
- **log** — optional structured logger

## Client — Mutating Methods

All mutating methods require `transactionHooks` and a transaction context (`tx`). Side effects are buffered via hooks and flushed after commit.

### startJobChain

```typescript
const chain = await client.startJobChain({
  typeName: "send-email",
  input: { to: "alice@..." },
  transactionHooks,
  tx,
  deduplication?: DeduplicationOptions,
  schedule?: ScheduleOptions,
  blockers?: JobChain[],
});
```

Returns `JobChain & { deduplicated: boolean }`.

### startJobChains

```typescript
const chains = await client.startJobChains({
  items: [
    { typeName: "send-email", input: { to: "alice@..." } },
    { typeName: "send-email", input: { to: "bob@..." } },
  ],
  transactionHooks,
  tx,
});
```

Returns `Array<JobChain & { deduplicated: boolean }>`.

### deleteJobChain

```typescript
const deleted = await client.deleteJobChain({
  id: chainId,
  cascade?: boolean,
  transactionHooks,
  tx,
});
```

Returns `JobChain | undefined`.

Deletes a single job chain by ID. Returns the deleted chain, or `undefined` if no chain with that ID exists. When **cascade** is `true`, transitive dependencies are included (default: `false`). Throws `BlockerReferenceError` if external jobs depend on it.

### deleteJobChains

```typescript
const deleted = await client.deleteJobChains({
  ids: [chainId1, chainId2],
  cascade?: boolean,
  transactionHooks,
  tx,
});
```

Returns `JobChain[]`.

Deletes the specified job chains. Missing IDs are silently skipped (use `deleteJobChain` for strict lookup). When **cascade** is `true`, transitive dependencies are included (default: `false`). Throws `BlockerReferenceError` if external jobs depend on the targeted chains.

### triggerJob

```typescript
const job = await client.triggerJob({
  id: jobId,
  transactionHooks,
  tx,
});
```

Returns `Job`.

Triggers a pending job immediately by setting its `scheduledAt` to now. Throws `JobNotFoundError` if the job does not exist, `JobNotTriggerableError` if the job is not pending.

### triggerJobs

```typescript
const jobs = await client.triggerJobs({
  ids: [jobId1, jobId2],
  transactionHooks,
  tx,
});
```

Returns `Job[]` in input order.

Triggers multiple pending jobs in one call. Validation is atomic — if any job is missing or not pending, the entire call fails with `JobNotFoundError` or `JobNotTriggerableError` before any job is triggered. Empty `ids` returns `[]`.

### completeJobChain

```typescript
const chain = await client.completeJobChain({
  typeName: "send-email",
  id: chainId,
  transactionHooks,
  tx,
  complete: async ({ job, complete }) => {
    return complete(job, async ({ continueWith }) => {
      return { sent: true };
    });
  },
});
```

Returns `CompletedJobChain` when the chain is completed, or `JobChain` when continued via `continueWith`.

The **complete** callback receives the current (latest) job in the chain. Call `complete(job, callback)` to finalize the job. Inside the callback, return an output value to finish the chain, or call `continueWith({ typeName, input })` to schedule the next job in the chain.

Throws `JobChainNotFoundError`, `JobTypeMismatchError`, or `JobAlreadyCompletedError`.

## Client — Read-Only Methods

Read-only methods accept an optional transaction context. When omitted, the adapter acquires its own connection.

### getJobChain

```typescript
const chain = await client.getJobChain({
  id: chainId,
  typeName?: "send-email",
});
```

Returns `JobChain | undefined`.

When **typeName** is provided, the return type is narrowed to that job type. Throws `JobTypeMismatchError` if the chain exists but has a different type.

### getJob

```typescript
const job = await client.getJob({
  id: jobId,
  typeName?: "send-email",
});
```

Returns `Job | undefined`.

When **typeName** is provided, the return type is narrowed to that job type.

### awaitJobChain

```typescript
const completed = await client.awaitJobChain(
  { id: chainId, typeName?: "send-email" },
  {
    timeoutMs: 30_000,
    pollIntervalMs?: 15_000,
    signal?: AbortSignal,
  },
);
```

Returns `CompletedJobChain`.

Waits for the specified chain to complete.

- **timeoutMs** — required, maximum wait time
- **pollIntervalMs** — polling fallback interval (default: `15_000`)
- **signal** — optional `AbortSignal` for external cancellation

Throws `WaitChainTimeoutError` on timeout or abort, `JobChainNotFoundError`, or `JobTypeMismatchError`.

### listJobChains

```typescript
const page = await client.listJobChains({
  filter?: {
    typeName?: string[],
    status?: JobStatus[],
    id?: string[],
    jobId?: string[],
    root?: boolean,
    from?: Date,
    to?: Date,
  },
  orderDirection?: "asc" | "desc",
  cursor?: string,
  limit?: number,
});
```

Returns `Page<JobChain>`.

Paginated listing of job chains. **root** filters to only root chains (not blockers). Default **orderDirection** is `"desc"`. Default **limit** is `50`.

### listJobs

```typescript
const page = await client.listJobs({
  filter?: {
    typeName?: string[],
    status?: JobStatus[],
    id?: string[],
    jobChainTypeName?: string[],
    jobChainId?: string[],
    from?: Date,
    to?: Date,
  },
  orderDirection?: "asc" | "desc",
  cursor?: string,
  limit?: number,
});
```

Returns `Page<Job>`.

Paginated listing of jobs. **jobChainTypeName** filters to jobs belonging to chains started by the given entry type names. Default **orderDirection** is `"desc"`. Default **limit** is `50`.

### listJobChainJobs

```typescript
const page = await client.listJobChainJobs({
  jobChainId: chainId,
  typeName?: "send-email",
  orderDirection?: "asc" | "desc",
  cursor?: string,
  limit?: number,
});
```

Returns `Page<Job>`.

Lists all jobs within a specific chain. Default **orderDirection** is `"asc"`. Default **limit** is `50`.

### getJobBlockers

```typescript
const blockers = await client.getJobBlockers({
  jobId: jobId,
  typeName?: "send-email",
});
```

Returns `JobChain[]`.

Returns the blocker chains for a given job. The result is not paginated because blockers are bounded by design.

### listBlockedJobs

```typescript
const page = await client.listBlockedJobs({
  jobChainId: chainId,
  typeName?: "send-email",
  orderDirection?: "asc" | "desc",
  cursor?: string,
  limit?: number,
});
```

Returns `Page<Job>`.

Lists jobs that are blocked by the specified chain. Default **orderDirection** is `"desc"`. Default **limit** is `50`.

## See Also

- [Worker](/queuert/reference/queuert/worker/) — Worker configuration and job processing
- [Types](/queuert/reference/queuert/types/) — Job, JobChain, and configuration types
- [Utilities](/queuert/reference/queuert/utilities/) — Composition helpers and utility functions
- [Transaction Hooks](/queuert/reference/queuert/transaction-hooks/) — Transaction hooks API reference
- [Errors](/queuert/reference/queuert/errors/) — Error classes reference
- [Transaction Hooks Guide](/queuert/guides/transaction-hooks/) — Usage guide
