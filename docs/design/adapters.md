# Adapter Design

## Overview

This document describes the design philosophy behind Queuert's adapter system, including factory patterns, context management, and notification optimization.

## Async Factory Pattern

Public-facing adapter factories that may perform I/O are async for consistency:

```typescript
// Public adapters - async (may perform I/O)
createQueuertClient → Promise<QueuertClient>
createQueuertInProcessWorker → Promise<QueuertInProcessWorker>
createPgStateAdapter → Promise<StateAdapter>
createSqliteStateAdapter → Promise<StateAdapter>
createMongoStateAdapter → Promise<StateAdapter>
createPgNotifyAdapter → Promise<NotifyAdapter>
createRedisNotifyAdapter → Promise<NotifyAdapter>
createNatsNotifyAdapter → Promise<NotifyAdapter>
```

In-process and internal-only factories remain sync since they have no I/O:

```typescript
// Internal adapters - sync (no I/O)
createInProcessStateAdapter → StateAdapter
createInProcessNotifyAdapter → NotifyAdapter
```

### Rationale

1. **Consistency**: All public factories follow the same async pattern, reducing cognitive load
2. **Future-proofing**: Factories can add initialization I/O without breaking API
3. **Explicit async**: Callers know to `await` and handle potential errors

## StateAdapter Design

### Atomic Operations Principle

All StateAdapter methods must complete in a **single database round-trip**. This is a core design principle:

- **O(1) round trips**: Each method—regardless of how many jobs it affects—executes exactly one database operation
- **O(n) is incorrect**: If an adapter implementation requires multiple round trips proportional to input size, the implementation is wrong
- **Batch operations**: Methods accepting arrays (e.g., `createJobs`, `markJobsAsCompleted`) must use batch SQL (multi-row INSERT, UPDATE with IN clause, CTEs) rather than loops

This principle ensures predictable performance and proper atomicity. Examples of correct patterns:

```sql
-- Correct: Single INSERT with multiple VALUES
INSERT INTO jobs (id, type_name, input) VALUES
  ($1, $2, $3),
  ($4, $5, $6),
  ($7, $8, $9);

-- Correct: Single UPDATE with array parameter
UPDATE jobs SET status = 'completed' WHERE id = ANY($1);

-- Correct: CTE for complex multi-step operations
WITH updated AS (
  UPDATE jobs SET status = 'in_progress' WHERE ...
  RETURNING *
)
INSERT INTO job_history SELECT * FROM updated;
```

Anti-patterns to avoid:

```typescript
// WRONG: O(n) round trips
for (const job of jobs) {
  await db.query("INSERT INTO jobs VALUES ($1, $2)", [job.id, job.input]);
}

// WRONG: Sequential updates
for (const jobId of jobIds) {
  await db.query("UPDATE jobs SET status = $1 WHERE id = $2", ["completed", jobId]);
}
```

### Context Architecture

The `StateAdapter` type accepts two generic parameters:

```typescript
StateAdapter<TTxContext, TJobId>;
```

- `TTxContext extends BaseTxContext`: Transaction context type containing database client/session info
- `TJobId extends string`: The job ID type for input parameters

The context is named `TTxContext` (transaction context) because it's exclusively used within transactions. When you call `runInTransaction`, the callback receives a context that represents an active transaction.

### StateProvider Interface

Users create a `StateProvider` implementation to integrate with their database client:

```typescript
interface PgStateProvider<TTxContext> {
  // Manages connection and transaction - called for transactional operations
  runInTransaction: <T>(fn: (txContext: TTxContext) => Promise<T>) => Promise<T>;

  // Execute SQL - when txContext is provided uses it, when omitted manages own connection
  executeSql: (options: {
    txContext?: TTxContext;
    sql: string;
    params?: unknown[];
  }) => Promise<unknown[]>;
}
```

### Optional txContext Semantics

All `StateAdapter` operation methods accept an optional `txContext` parameter:

- **With txContext**: Uses the provided transaction connection. The txContext must come from a `runInTransaction` callback.
- **Without txContext**: The adapter acquires its own connection from the pool, executes the operation, and releases it.

This design enables:

1. **Transactional operations**: Multiple operations within a single transaction

   ```typescript
   await stateAdapter.runInTransaction(async (txContext) => {
     const job = await stateAdapter.getJobById({ txContext, jobId });
     await stateAdapter.completeJob({ txContext, jobId, output, workerId });
   });
   ```

2. **Non-transactional operations**: Standalone operations that manage their own connection

   ```typescript
   // No transaction needed for simple reads
   const job = await stateAdapter.getJobById({ jobId });
   ```

3. **DDL operations**: Migrations like `CREATE INDEX CONCURRENTLY` that cannot run inside transactions
   ```typescript
   // executeSql without txContext for DDL
   await stateProvider.executeSql({ sql: "CREATE INDEX CONCURRENTLY ..." });
   ```

Provider implementations can validate that contexts passed to `executeSql` are valid transaction contexts:

```typescript
// Example: Kysely provider validation
executeSql: async ({ txContext, sql, params }) => {
  if (txContext && !txContext.db.isTransaction) {
    throw new Error("Provided context is not in a transaction");
  }
  // ...
};
```

### NotifyProvider Interface

NotifyProvider implementations manage connections internally - no context parameters:

```typescript
interface PgNotifyProvider {
  publish: (channel: string, message: string) => Promise<void>;
  subscribe: (
    channel: string,
    onMessage: (message: string) => void,
  ) => Promise<() => Promise<void>>;
}
```

The provider maintains a dedicated connection for subscriptions and acquires/releases connections for publish operations automatically.

### Reaper Support

The `removeExpiredJobLease` method supports an `ignoredJobIds` parameter to prevent race conditions in concurrent workers:

```typescript
removeExpiredJobLease: (params: {
  txContext?: TTxContext;
  typeNames: string[];
  ignoredJobIds?: TJobId[]; // Jobs to skip when reaping
}) => Promise<StateJob | undefined>;
```

**Why `ignoredJobIds` exists:**

When a worker runs with multiple concurrent slots (`concurrency.maxSlots > 1`), there's a potential race condition:

1. Worker acquires job A in slot 1 with a lease
2. Job A's lease expires before renewal (e.g., slow processing, GC pause)
3. Worker's reaper runs and sees job A has an expired lease
4. Without `ignoredJobIds`, the reaper would transition job A back to `pending`
5. Now job A is being processed AND marked as pending—a corrupted state

The `ignoredJobIds` parameter allows the worker to exclude jobs it's currently processing from reaping. Custom adapter implementations must filter out these job IDs when selecting expired leases.

### Internal Type Design

`StateJob` is a non-generic type with `string` for all ID fields:

```typescript
interface StateJob {
  id: string;
  rootChainId: string;
  chainId: string;
  originId: string | null;
  // ... other fields
}
```

The `StateAdapter` methods accept `TJobId` for input parameters but return plain `StateJob`. This simplifies internal code while allowing adapters to expose typed IDs to consumers via type helpers like `GetStateAdapterJobId<TStateAdapter>`.

## NotifyAdapter Design

### Broadcast Semantics

All notifications use broadcast (pub/sub) semantics:

- `notifyJobScheduled(typeName, count)`: Broadcasts to all workers listening for this job type
- `listenJobChainCompleted(chainId, callback)`: Receives notification when chain completes
- `listenJobOwnershipLost(jobId, callback)`: Receives notification when job ownership is lost

### Hint-Based Optimization

To prevent thundering herd when many workers are idle, notifications include a hint count:

1. **Scheduling**: `notifyJobScheduled(typeName, count)` creates a hint key with the count and publishes with a unique hintId
2. **Receiving**: Workers atomically decrement the hint count. Only workers that successfully decrement (hint > 0) proceed to query the database
3. **Effect**: When N jobs are scheduled, exactly N workers query the database; others skip and wait for the next notification

Implementation varies by adapter:

- **Redis**: Lua scripts for atomic decrement
- **NATS with JetStream KV**: Revision-based CAS operations
- **PostgreSQL/NATS without KV**: No optimization (all listeners query database)
- **In-process**: Synchronous counter operations

### Callback Pattern

All `listen*` methods accept a callback and return a dispose function:

```typescript
const dispose = await notifyAdapter.listenJobScheduled(typeNames, (typeName) => {
  // Called when notification arrives
});

try {
  // ... do work ...
} finally {
  await dispose();
}
```

Key behaviors:

- Async setup: Subscription is active when promise resolves
- Callback is called synchronously when notification arrives (no race condition)
- Dispose function cleans up the subscription

## ObservabilityAdapter Design

### Primitive Data Interface

The `ObservabilityAdapter` accepts primitive data types (not domain objects):

```typescript
interface ObservabilityAdapter {
  jobCreated(data: JobBasicData): void;
  jobAttemptStarted(data: JobProcessingData): void;
  // ... primitive data types
}
```

### Rationale

1. **Decoupling**: Adapter implementations don't need to understand domain objects
2. **Stability**: Primitive data types change less often than domain objects

### Noop Default

When no `observabilityAdapter` is provided, a noop implementation is used automatically. This makes observability opt-in without cluttering application code with null checks.

## Summary

Queuert's adapter design emphasizes:

1. **Atomic O(1) operations**: Every adapter method completes in a single database round-trip regardless of input size
2. **Consistent async factories**: Public adapters are always async
3. **Optional txContext**: StateProvider operations support optional txContext for non-transactional operations
4. **Internal connection management**: NotifyProvider manages connections internally with no txContext parameters
5. **Broadcast with optimization**: NotifyAdapter uses hints to prevent thundering herd
6. **Two-layer observability**: Low-level primitives for adapters, high-level objects for internal use
