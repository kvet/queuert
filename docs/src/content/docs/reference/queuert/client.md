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
  registry: JobTypeRegistry,
  log?: Log,
});
```

Returns `Promise<Client>`.

- **stateAdapter** -- database adapter for job persistence
- **notifyAdapter** -- optional pub/sub adapter for real-time notifications between client and workers
- **observabilityAdapter** -- optional adapter for metrics and tracing
- **registry** -- job type registry created by `defineJobTypes()` or `createJobTypeRegistry()`
- **log** -- optional structured logger

## Client — Mutating Methods

All mutating methods require `transactionHooks` and a transaction context (`tx`). Side effects are buffered via hooks and flushed after commit.

### startJobChain

```typescript
const chain = await client.startJobChain({
  typeName: "send-email",
  input: { to: "..." },
  transactionHooks,
  tx,
  deduplication?: DeduplicationOptions,
  schedule?: ScheduleOptions,
  blockers?: JobChain[],
});
```

Returns `JobChain & { deduplicated: boolean }`.

- **typeName** -- must be an entry job type
- **input** -- typed to match the job type definition
- **blockers** -- required when the job type defines blockers
- **deduplication** -- when it matches an existing chain, the returned object has `deduplicated: true` and no new chain is created

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

Deletes the specified job chains. When **cascade** is `true`, transitive dependencies are included (default: `false`). Throws `BlockerReferenceError` if external jobs depend on the targeted chains.

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

- **timeoutMs** -- required, maximum wait time
- **pollIntervalMs** -- polling fallback interval (default: `15_000`)
- **signal** -- optional `AbortSignal` for external cancellation

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
    id?: string[],
    jobChainId?: string[],
    status?: JobStatus[],
    from?: Date,
    to?: Date,
  },
  orderDirection?: "asc" | "desc",
  cursor?: string,
  limit?: number,
});
```

Returns `Page<Job>`.

Paginated listing of jobs. Default **orderDirection** is `"desc"`. Default **limit** is `50`.

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

## Transaction Hooks

### withTransactionHooks

```typescript
await withTransactionHooks(async (transactionHooks) => {
  await db.transaction(async (tx) => {
    await client.startJobChain({ tx, transactionHooks, ... });
  });
});
```

The recommended approach. Automatically flushes buffered side effects on success and discards them on error.

### createTransactionHooks

```typescript
const { transactionHooks, flush, discard } = createTransactionHooks();
try {
  await db.transaction(async (tx) => {
    await client.startJobChain({ tx, transactionHooks, ... });
  });
  await flush();
} catch {
  await discard();
}
```

Manual lifecycle for advanced use cases. Call `flush()` after the transaction commits to emit buffered side effects. Call `discard()` on error to drop them.

### TransactionHooks

```typescript
type TransactionHooks = {
  set<T>(key: symbol, hook: HookDef<T>): void;
  getOrInsert<T>(key: symbol, factory: () => HookDef<T>): T;
  get<T>(key: symbol): T;
  has(key: symbol): boolean;
  delete(key: symbol): void;
};
```

The hooks container passed to all mutating client methods. Manages keyed hook definitions that buffer side effects during a transaction.

### TransactionHooksHandle

```typescript
type TransactionHooksHandle = {
  transactionHooks: TransactionHooks;
  flush: () => Promise<void>;
  discard: () => Promise<void>;
};
```

Returned by `createTransactionHooks()`. Provides the `transactionHooks` instance along with explicit `flush` and `discard` controls.

## See Also

- [Worker](/queuert/reference/queuert/worker/) — Worker configuration and job processing
- [Types](/queuert/reference/queuert/types/) — Job, JobChain, and configuration types
- [Errors](/queuert/reference/queuert/errors/) — Error classes reference
- [Client API](/queuert/advanced/client-api/) — Architectural overview
- [Transaction Hooks](/queuert/guides/transaction-hooks/) — Usage guide
