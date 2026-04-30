---
title: Client
description: Client API, mutating/read-only methods, and client-related types for the queuert core package.
sidebar:
  order: 1
---

## createClient

```typescript
const client = await createClient({
  stateAdapter: StateAdapter,
  notifyAdapter?: NotifyAdapter,
  observabilityAdapter?: ObservabilityAdapter,
  jobTypes: JobTypes,
  log?: Log,
});
```

Returns `Promise<Client>`.

- **stateAdapter** — database adapter for job persistence
- **notifyAdapter** — optional pub/sub adapter for real-time notifications between client and workers
- **observabilityAdapter** — optional adapter for metrics and tracing
- **jobTypes** — job type registry created by `defineJobTypes()` or `createJobTypes()`
- **log** — optional structured logger

## Client — Mutating Methods

All mutating methods require `transactionHooks` and a transaction context (`tx`). Side effects are buffered via hooks and flushed after commit.

### startChain

```typescript
const chain = await client.startChain({
  typeName: "send-email",
  input: { to: "alice@..." },
  transactionHooks,
  tx,
  deduplication?: DeduplicationOptions,
  schedule?: ScheduleOptions,
  blockers?: Chain[],
});
```

Returns `Chain & { deduplicated: boolean }`.

### startChains

```typescript
const chains = await client.startChains({
  items: [
    { typeName: "send-email", input: { to: "alice@..." } },
    { typeName: "send-email", input: { to: "bob@..." } },
  ],
  transactionHooks,
  tx,
});
```

Returns `Array<Chain & { deduplicated: boolean }>`.

### deleteChain

```typescript
const deleted = await client.deleteChain({
  id: chainId,
  cascade?: boolean,
  transactionHooks,
  tx,
});
```

Returns `Chain | undefined`.

Deletes a single chain by ID. Returns the deleted chain, or `undefined` if no chain with that ID exists. When **cascade** is `true`, transitive dependencies are included (default: `false`). Throws `BlockerReferenceError` if external jobs depend on it.

### deleteChains

```typescript
const deleted = await client.deleteChains({
  ids: [chainId1, chainId2],
  cascade?: boolean,
  transactionHooks,
  tx,
});
```

Returns `Chain[]`.

Deletes the specified chains. Missing IDs are silently skipped (use `deleteChain` for strict lookup). When **cascade** is `true`, transitive dependencies are included (default: `false`). Throws `BlockerReferenceError` if external jobs depend on the targeted chains.

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

### completeChain

```typescript
const chain = await client.completeChain({
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

Returns `CompletedChain` when the chain is completed, or `Chain` when continued via `continueWith`.

The **complete** callback receives the current (latest) job in the chain. Call `complete(job, callback)` to finalize the job. Inside the callback, return an output value to finish the chain, or call `continueWith({ typeName, input })` to schedule the next job in the chain.

Throws `ChainNotFoundError`, `JobTypeMismatchError`, or `JobAlreadyCompletedError`.

## Client — Read-Only Methods

Read-only methods accept an optional transaction context. When omitted, the adapter acquires its own connection.

### getChain

```typescript
const chain = await client.getChain({
  id: chainId,
  typeName?: "send-email",
});
```

Returns `Chain | undefined`.

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

### awaitChain

```typescript
const completed = await client.awaitChain(
  { id: chainId, typeName?: "send-email" },
  {
    timeoutMs: 30_000,
    pollIntervalMs?: 15_000,
    signal?: AbortSignal,
  },
);
```

Returns `CompletedChain`.

Waits for the specified chain to complete.

- **timeoutMs** — required, maximum wait time
- **pollIntervalMs** — polling fallback interval (default: `15_000`)
- **signal** — optional `AbortSignal` for external cancellation

Throws `WaitChainTimeoutError` on timeout or abort, `ChainNotFoundError`, or `JobTypeMismatchError`.

### listChains

```typescript
const page = await client.listChains({
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

Returns `Page<Chain>`.

Paginated listing of chains. **root** filters to only root chains (not blockers). Default **orderDirection** is `"desc"`. Default **limit** is `50`.

### listJobs

```typescript
const page = await client.listJobs({
  filter?: {
    typeName?: string[],
    status?: JobStatus[],
    id?: string[],
    chainTypeName?: string[],
    chainId?: string[],
    from?: Date,
    to?: Date,
  },
  orderDirection?: "asc" | "desc",
  cursor?: string,
  limit?: number,
});
```

Returns `Page<Job>`.

Paginated listing of jobs. **chainTypeName** filters to jobs belonging to chains started by the given entry type names. Default **orderDirection** is `"desc"`. Default **limit** is `50`.

### listChainJobs

```typescript
const page = await client.listChainJobs({
  chainId: chainId,
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

Returns `Chain[]`.

Returns the blocker chains for a given job. The result is not paginated because blockers are bounded by design.

### listBlockedJobs

```typescript
const page = await client.listBlockedJobs({
  chainId: chainId,
  typeName?: "send-email",
  orderDirection?: "asc" | "desc",
  cursor?: string,
  limit?: number,
});
```

Returns `Page<Job>`.

Lists jobs that are blocked by the specified chain. Default **orderDirection** is `"desc"`. Default **limit** is `50`.

## Types

### DeduplicationOptions

```typescript
type DeduplicationOptions<TJobId> = {
  key: string;
  scope?: "incomplete" | "any"; // default: "incomplete"
  windowMs?: number; // required when scope is "any"
  excludeChainIds?: TJobId[];
};
```

Chain deduplication configuration passed to `startChain`.

- **key** — identifies the logical operation
- **scope** — match incomplete chains only (`"incomplete"`, the default) or all chains within the time window (`"any"`)
- **windowMs** — required when scope is `"any"`
- **excludeChainIds** — chain IDs to exclude from deduplication matching; useful for recurring jobs that self-schedule within a completion callback where the current chain is still incomplete

### ScheduleOptions

```typescript
type ScheduleOptions = { at: Date; afterMs?: never } | { at?: never; afterMs: number };
```

Deferred job scheduling. The two fields are mutually exclusive.

- **at** — schedules for an absolute timestamp
- **afterMs** — schedules relative to the current time

### Page

```typescript
type Page<T> = {
  items: T[];
  nextCursor: string | null; // null when no more pages
};
```

Cursor-based pagination wrapper returned by all list methods. Pass **nextCursor** back as the `cursor` parameter to fetch the next page.

### OrderDirection

```typescript
type OrderDirection = "asc" | "desc";
```

Controls sort order in list queries. Most list methods default to `"desc"`.

## See Also

- [Worker](/queuert/reference/queuert/worker/) — Worker configuration and job processing
- [Entities](/queuert/reference/queuert/entities/) — `Job`, `Chain`, and resolved variants
- [Utilities](/queuert/reference/queuert/utilities/) — Composition helpers and utility functions
- [Transaction Hooks](/queuert/reference/queuert/transaction-hooks/) — Transaction hooks API reference
- [Errors](/queuert/reference/queuert/errors/) — Error classes reference
- [Transaction Hooks Guide](/queuert/guides/transaction-hooks/) — Usage guide
