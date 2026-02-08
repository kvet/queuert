# Adapter Design

## Overview

This document describes the design philosophy behind Queuert's adapter system, including factory patterns, context management, and notification optimization.

## Async Factory Pattern

Public-facing adapter factories that may perform I/O are async for consistency:

```typescript
// Public adapters - async (may perform I/O)
createClient → Promise<Client>
createInProcessWorker → Promise<InProcessWorker>
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

This principle ensures predictable performance and proper atomicity. Use batch SQL (multi-row INSERT, UPDATE with IN/ANY clause, CTEs) rather than loops.

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

- **With txContext**: Uses the provided transaction connection (must come from a `runInTransaction` callback)
- **Without txContext**: Acquires its own connection from the pool, executes, and releases

This enables transactional operations, standalone operations, and DDL operations (like `CREATE INDEX CONCURRENTLY`) that cannot run inside transactions.

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

The `removeExpiredJobLease` method supports an `ignoredJobIds` parameter to prevent race conditions when a worker runs with multiple concurrent slots (`concurrency > 1`). Without it, a worker could reap its own in-progress job if the lease expires before renewal, causing corrupted state. Custom adapter implementations must filter out these job IDs when selecting expired leases.

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

All `listen*` methods accept a callback and return a dispose function. Subscription is active when the promise resolves, and the callback is called synchronously when notifications arrive (no race condition).

## ObservabilityAdapter Design

The `ObservabilityAdapter` provides two observability mechanisms:

1. **Metrics**: Methods accept primitive data types (not domain objects) for decoupling and stability. Counters, histograms, and gauges track worker lifecycle, job events, and durations.

2. **Tracing**: `startJobSpan` and `startAttemptSpan` methods return handles for managing span lifecycle. Spans follow OpenTelemetry messaging conventions with PRODUCER spans for job creation and CONSUMER spans for processing.

When no adapter is provided, a noop implementation is used automatically, making observability opt-in. See [ObservabilityAdapter Design](observability-adapter.md) for the full interface, [OTEL Tracing](otel-tracing.md) for span hierarchy, and [OTEL Metrics](otel-metrics.md) for available metrics.

## Summary

Queuert's adapter design emphasizes:

1. **Atomic O(1) operations**: Every adapter method completes in a single database round-trip regardless of input size
2. **Consistent async factories**: Public adapters are always async
3. **Optional txContext**: StateProvider operations support optional txContext for non-transactional operations
4. **Internal connection management**: NotifyProvider manages connections internally with no txContext parameters
5. **Broadcast with optimization**: NotifyAdapter uses hints to prevent thundering herd
6. **Two-layer observability**: Low-level primitives for adapters, high-level objects for internal use
