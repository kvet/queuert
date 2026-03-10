---
title: Adapter Architecture
description: State, notify, and observability adapter design.
sidebar:
  order: 5
---

## Overview

This document describes the design philosophy behind Queuert's adapter system, including factory patterns, context management, and notification optimization.

## Provider vs Adapter

Queuert uses a two-layer abstraction for external integrations:

- **Provider** — a minimal interface that users implement to wrap their chosen database or messaging client. It contains only low-level operations (`executeSql`, `runInTransaction`, `publish`/`subscribe`). Each driver library (pg, better-sqlite3, ioredis, etc.) gets its own provider implementation.
- **Adapter** — a high-level interface that Queuert builds from a provider via a `create*` factory function. Adapters contain the full domain logic (job lifecycle, state transitions, notification semantics) and are what `createClient` and `createInProcessWorker` consume.

The factory transforms a provider into an adapter:

```
PgStateProvider      → createPgStateAdapter()        → StateAdapter
SqliteStateProvider  → createSqliteStateAdapter()    → StateAdapter
PgNotifyProvider     → createPgNotifyAdapter()       → NotifyAdapter
RedisNotifyProvider  → createRedisNotifyAdapter()    → NotifyAdapter
                       createNatsNotifyAdapter()     → NotifyAdapter
```

This separation keeps driver-specific code isolated in the provider while the adapter layer remains database-agnostic. Users only implement the provider; they never implement the adapter interface directly.

## Async Factory Pattern

Public-facing adapter factories that may perform I/O are async for consistency. In-process and internal-only factories remain sync since they have no I/O.

### Rationale

1. **Consistency**: All public factories follow the same async pattern, reducing cognitive load
2. **Future-proofing**: Factories can add initialization I/O without breaking API
3. **Explicit async**: Callers know to `await` and handle potential errors

## StateAdapter Design

### Atomic Operations Principle

All StateAdapter methods must complete in a **single database round-trip**, where the database engine supports it. This is a core design principle:

- **O(1) round trips**: Each method—regardless of how many jobs it affects—executes exactly one database operation
- **O(n) is incorrect**: If an adapter implementation requires multiple round trips proportional to input size, the implementation is wrong
- **Batch operations**: Methods accepting arrays (e.g., `deleteJobChains`, `addJobBlockers`) must use batch SQL (multi-row INSERT, UPDATE with IN clause, CTEs) rather than loops

This principle ensures predictable performance and proper atomicity. Use batch SQL (multi-row INSERT, UPDATE with IN/ANY clause, CTEs) rather than loops.

**SQLite exception**: SQLite does not support writeable CTEs with RETURNING in the same way as PostgreSQL. Operations like `addJobBlockers` and `deleteJobChains` use multiple sequential queries within a single transaction instead of a single CTE. This is safe under SQLite's exclusive transaction locking model (which serializes all writes), but results in more round-trips per operation. This is an accepted trade-off for SQLite support.

### Context Architecture

The `StateAdapter` type accepts two generic parameters: `TTxContext` (transaction context containing database client/session info) and `TJobId` (the job ID type for input parameters).

The context is named `TTxContext` (transaction context) because it's exclusively used within transactions. When you call `runInTransaction`, the callback receives a context that represents an active transaction.

### StateProvider Interface

Users create a `StateProvider` implementation to integrate with their database client:

```typescript
interface PgStateProvider<TTxContext> {
  // Manages connection and transaction - called for transactional operations
  runInTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  // Execute SQL - when txCtx is provided uses it, when omitted manages own connection
  executeSql: (options: {
    txCtx?: TTxContext;
    sql: string;
    params?: unknown[];
  }) => Promise<unknown[]>;
}
```

### Optional txCtx Semantics

All `StateAdapter` operation methods accept an optional `txCtx` parameter:

- **With txCtx**: Uses the provided transaction connection (must come from a `runInTransaction` callback)
- **Without txCtx**: Acquires its own connection from the pool, executes, and releases

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

The `reapExpiredJobLease` method supports an `ignoredJobIds` parameter to prevent race conditions when a worker runs with multiple concurrent slots (`concurrency > 1`). Without it, a worker could reap its own in-progress job if the lease expires before renewal, causing corrupted state. Custom adapter implementations must filter out these job IDs when selecting expired leases.

### Internal Type Design

`StateJob` is a non-generic type with `string` for all ID fields. The `StateAdapter` methods accept `TJobId` for input parameters but return plain `StateJob`. This simplifies internal code while allowing adapters to expose typed IDs to consumers via type helpers like `GetStateAdapterJobId<TStateAdapter>`.

## NotifyAdapter Design

### Broadcast Semantics

All notifications use broadcast (pub/sub) semantics with three notify/listen pairs: job scheduling, chain completion, and ownership loss. See the `NotifyAdapter` type TSDoc for method details.

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

When no adapter is provided, a noop implementation is used automatically, making observability opt-in. See [OTEL Tracing](../otel-tracing/) for span hierarchy and [OTEL Metrics](../otel-metrics/) for available metrics.

### Transactional Buffering

Observability events emitted inside database transactions are buffered and only flushed after the transaction commits. If the transaction rolls back, buffered events are discarded -- no misleading metrics or spans leak out. Buffering uses `TransactionHooks` -- the same mechanism that flushes notify events on commit.

**Buffered** -- events that represent write claims inside transactions:

- **Creation**: `jobChainCreated`, `jobCreated`, `jobBlocked`, and PRODUCER span ends from `createStateJob`
- **Completion**: `jobCompleted`, `jobDuration`, `completeJobSpan` (workerless), `jobChainCompleted`, `jobChainDuration`, `completeBlockerSpan`, `jobUnblocked` from `finishJob`
- **Worker complete**: `jobAttemptCompleted` and continuation PRODUCER span ends from the complete transaction in `job-process`
- **Error handling**: `jobAttemptFailed` from the error-handling transaction in `job-process`

**Not buffered** -- events that either need immediate context or occur outside transactions:

- **Span starts**: Need trace context immediately for DB writes that store trace IDs
- **Events outside transactions**: `jobAttemptStarted`, `jobAttemptDuration`, `jobAttemptLeaseRenewed`, attempt span ends (these occur outside the guarded transaction)
- **Read-only observations**: `refetchJobForUpdate` events observe state without making write claims

### Self-Cleaning

Both `createStateJob` and `finishJob` snapshot the observability buffer on entry and rollback on throw, ensuring partial events from a failed operation don't accumulate in the buffer.

## See Also

- [OTEL Tracing](../otel-tracing/) — Span hierarchy and messaging conventions
- [OTEL Metrics](../otel-metrics/) — Counters, histograms, and gauges
- [Client API](/queuert/reference/queuert/client/) — Mutation and query methods
- [In-Process Worker](../in-process-worker/) — Worker lifecycle and lease management
