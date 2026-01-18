# Adapter Design

## Overview

This document describes the design philosophy behind Queuert's adapter system, including factory patterns, context management, and notification optimization.

## Async Factory Pattern

Public-facing adapter factories that may perform I/O are async for consistency:

```typescript
// Public adapters - async (may perform I/O)
createQueuert → Promise<Queuert>
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
createNoopNotifyAdapter → NotifyAdapter
```

### Rationale

1. **Consistency**: All public factories follow the same async pattern, reducing cognitive load
2. **Future-proofing**: Factories can add initialization I/O without breaking API
3. **Explicit async**: Callers know to `await` and handle potential errors

## StateAdapter Design

### Dual-Context Architecture

The `StateAdapter` type accepts three generic parameters:

```typescript
StateAdapter<TTxContext, TContext, TJobId>
```

- `TTxContext extends BaseStateAdapterContext`: Transaction context type, used within `runInTransaction` callbacks
- `TContext extends BaseStateAdapterContext`: General context type, provided by `provideContext`
- `TJobId extends string`: The job ID type for input parameters

This dual-context design enables operations like migrations to run outside transactions. For example, PostgreSQL's `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, so the provider needs a way to execute non-transactional operations.

When transaction and general contexts are identical, use the same type for both:

```typescript
// SQLite - same context for both
StateAdapter<TContext, TContext, TJobId>
```

### StateProvider Interface

Users create a `StateProvider` implementation to integrate with their database client:

```typescript
interface StateProvider<TTxContext, TContext> {
  provideContext: <T>(callback: (ctx: TContext) => Promise<T>) => Promise<T>;
  runInTransaction: <T>(ctx: TContext, callback: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  execute: (ctx: TTxContext | TContext, sql: string, params?: unknown[]) => Promise<Row[]>;
  // ... other methods
}
```

This abstraction allows the same state adapter to work with raw `pg`, Drizzle, Prisma, Kysely, or any other database client.

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

The `StateAdapter` methods accept `TJobId` for input parameters but return plain `StateJob`. This simplifies internal code while allowing adapters to expose typed IDs to consumers via type helpers:

```typescript
type GetStateAdapterTxContext<TStateAdapter> = // extracts TTxContext
type GetStateAdapterContext<TStateAdapter> = // extracts TContext
type GetStateAdapterJobId<TStateAdapter> = // extracts TJobId
```

These helpers are useful when building generic code that works with any state adapter.

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

1. **Consistent async factories**: Public adapters are always async
2. **Dual-context flexibility**: StateAdapter supports transactional and non-transactional operations
3. **Broadcast with optimization**: NotifyAdapter uses hints to prevent thundering herd
4. **Two-layer observability**: Low-level primitives for adapters, high-level objects for internal use
