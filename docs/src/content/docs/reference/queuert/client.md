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
  id?: JobId,
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
    { typeName: "send-email", id: "explicit-id", input: { to: "bob@..." } },
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

### rescheduleJob

```typescript
const job = await client.rescheduleJob({
  id: jobId,
  schedule: { afterMs: 60_000 }, // optional; omit to run now
  transactionHooks,
  tx,
});
```

Returns `Job`.

Reschedules a pending job by setting its `scheduledAt` from the optional `schedule` (`{ at }` | `{ afterMs }`). Omitting `schedule` reschedules to now; past times clamp to now. Throws `JobNotFoundError` if the job does not exist, or `JobNotReschedulableError` if the job is not pending.

### rescheduleJobs

```typescript
const jobs = await client.rescheduleJobs({
  ids: [jobId1, jobId2],
  schedule: { at: new Date("2025-01-01T00:00:00Z") }, // optional; omit to run now
  transactionHooks,
  tx,
});
```

Returns `Job[]` in input order.

Reschedules multiple pending jobs in one call, applying the same optional `schedule` to each (omitted = now). Validation is atomic — if any job is missing or not pending, the entire call fails with `JobsNotFoundError` or `JobsNotReschedulableError` (the plural batch variants, listing every offending id) before any job is rescheduled. Empty `ids` returns `[]`.

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

Throws `ChainNotFoundError`, `ChainTypeMismatchError`, or `JobAlreadyCompletedError`.

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

When **typeName** is provided, the return type is narrowed to that chain type. Throws `ChainTypeMismatchError` if the chain exists but has a different type.

### getChains

```typescript
const chains = await client.getChains({
  ids: [chainId1, chainId2],
  typeName?: "send-email",
});
```

Returns `(Chain | undefined)[]` — a positional array aligned with `ids`. Missing IDs produce `undefined`.

When **typeName** is provided, all found chains must match or `ChainTypeMismatchError` is thrown.

### getJob

```typescript
const job = await client.getJob({
  id: jobId,
  typeName?: "send-email",
});
```

Returns `Job | undefined`.

When **typeName** is provided, the return type is narrowed to that job type.

### getJobs

```typescript
const jobs = await client.getJobs({
  ids: [jobId1, jobId2],
  typeName?: "send-email",
});
```

Returns `(Job | undefined)[]` — a positional array aligned with `ids`. Missing IDs produce `undefined`.

When **typeName** is provided, all found jobs must match or `JobTypeMismatchError` is thrown.

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

Throws `WaitChainTimeoutError` on timeout or abort, `ChainNotFoundError`, or `ChainTypeMismatchError`.

### listChains

```typescript
const page = await client.listChains({
  typeName?: string[],
  independent?: boolean,
  chainId?: string[],
  from?: Date,
  to?: Date,
  orderDirection?: "asc" | "desc",
  cursor?: string,
  limit?: number,
} & (
  | { status?: undefined; orderBy?: "createdAt" }
  | { status: "running"; orderBy?: "createdAt" }
  | { status: "completed"; orderBy?: "createdAt" | "completedAt" }
));
```

Returns `Page<Chain>`.

Paginated listing of chains. **independent** filters to only independent chains (not blockers). **status** is a single string that routes the query to a status-specific index. **orderBy** is status-dependent and compile-time validated — `"completedAt"` is only available when `status` is `"completed"`. Default **orderDirection** is `"desc"`. Default **limit** is `50`.

### listJobs

```typescript
const page = await client.listJobs({
  typeName?: string[],
  chainTypeName?: string[],
  chainId?: string[],
  jobId?: string[],
  from?: Date,
  to?: Date,
  orderDirection?: "asc" | "desc",
  cursor?: string,
  limit?: number,
} & (
  | { status?: undefined; orderBy?: "createdAt" }
  | { status: "pending"; blocked?: boolean; orderBy?: "createdAt" | "scheduledAt" }
  | { status: "running"; orderBy?: "createdAt" | "attemptAt" | "attemptUntil" }
  | { status: "completed"; continued?: boolean; orderBy?: "createdAt" | "completedAt" }
));
```

Returns `Page<Job>`.

Paginated listing of jobs. **chainTypeName** filters to jobs belonging to chains started by the given entry type names. **status** is a single string that routes the query to a status-specific index. **orderBy** is status-dependent and compile-time validated. Default **orderDirection** is `"desc"`. Default **limit** is `50`.

### listChainJobs

```typescript
const page = await client.listChainJobs({
  chainId: chainId,
  chainTypeName?: "send-email",
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
  scope: "running" | "any";
  windowMs?: number; // required when scope is "any"
  excludeChainIds?: TJobId[];
};
```

Chain deduplication configuration passed to `startChain`.

- **key** — identifies the logical operation
- **scope** — required; match running chains only (`"running"`) or all chains within the time window (`"any"`)
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
