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

- **Provider** — a minimal interface that users implement to wrap their chosen database or messaging client. It contains only low-level operations (`executeSql`, `withTransaction`, `publish`/`subscribe`). Each driver library (pg, better-sqlite3, ioredis, etc.) gets its own provider implementation.
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

## Conformance

Because each `create*` factory produces an adapter with the same contract regardless of the provider underneath, Queuert ships a **conformance suite** that validates any provider-built adapter against that contract.

The suite is exposed as a framework-agnostic runner under the `queuert/conformance` subpath. Users wire it into a single `test()` block from their framework of choice; internal Queuert specs go through the same case list via a thin vitest binding so there's no drift between end-user validation and internal coverage.

See the [Conformance reference](/queuert/reference/queuert/conformance/) for the API and the [Custom Adapters](/queuert/advanced/custom-adapters/) guide for a walkthrough.

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
- **Batch operations**: Methods accepting arrays (e.g., `deleteChains`, `addJobBlockers`) must use batch SQL (multi-row INSERT, UPDATE with IN clause, CTEs) rather than loops

This principle ensures predictable performance and proper atomicity. Use batch SQL (multi-row INSERT, UPDATE with IN/ANY clause, CTEs) rather than loops.

**SQLite exception**: SQLite does not support writeable CTEs with RETURNING in the same way as PostgreSQL. Operations like `addJobBlockers` and `deleteChains` use multiple sequential queries within a single transaction instead of a single CTE. This is safe under SQLite's exclusive transaction locking model (which serializes all writes), but results in more round-trips per operation. This is an accepted trade-off for SQLite support.

### Context Architecture

The `StateAdapter` type accepts two generic parameters: `TTxContext` (transaction context containing database client/session info) and `TJobId` (the job ID type for input parameters).

The context is named `TTxContext` (transaction context) because it's exclusively used within transactions. When you call `withTransaction`, the callback receives a context that represents an active transaction.

### StateProvider Interface

Users create a `StateProvider` implementation to integrate with their database client. The concrete interfaces live in `@queuert/postgres` and `@queuert/sqlite`; the shape below is an illustrative reduction — see the TSDoc on `PgStateProvider` and `SqliteStateProvider` for the authoritative signatures (including `paramTypes`/`columnTypes` annotations required by the typed-SQL layer).

```typescript
interface PgStateProvider<TTxContext> {
  // Manages connection and transaction - called for transactional operations
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  // Execute SQL - when txCtx is provided uses it, when omitted manages own connection
  executeSql: (options: {
    txCtx?: TTxContext;
    sql: string;
    params?: unknown[];
    paramTypes: Record<number, RuntimeType>;
    columnTypes: Record<string, RuntimeType>;
  }) => Promise<unknown[]>;

  // Optional — only define when the provider owns resources beyond the caller-supplied client/pool
  close?: () => Promise<void>;
}
```

### Optional txCtx Semantics

All `StateAdapter` operation methods accept an optional `txCtx` parameter:

- **With txCtx**: Uses the provided transaction connection (must come from a `withTransaction` callback)
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
  // Optional — only define when the provider owns resources (e.g. a dedicated LISTEN client)
  close?: () => Promise<void>;
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

### Wake-Hint Methods

To prevent thundering herd when many workers are idle, the publisher attaches a per-typeName budget that gates how many listeners actually wake. Hints are an opt-in pair of methods on `NotifyAdapter`, both keyed by `typeName`:

- `provideWakeHint(typeName, count)` — publisher adds `count` to the budget. Composes additively across concurrent publishers (two `provideWakeHint(t, 3)` calls yield a budget of 6).
- `consumeWakeHint(typeName)` — listener atomically claims one slot. Returns `true` if a slot was claimed, or if no budget is currently tracked (graceful degradation). Returns `false` only when an explicit budget was set and is now exhausted.

Flow when scheduling N jobs of `typeName`:

1. Publisher calls `provideWakeHint(typeName, N)` followed by `notifyJobScheduled(typeName)`.
2. Each receiving worker calls `consumeWakeHint(typeName)`. The first N return `true` (worker queries the database); subsequent calls return `false` (worker skips).
3. When the hint key never existed or the TTL expired, `consumeWakeHint` falls back to `true` so listeners don't silently miss wakeups.

Adapters that don't support hints implement the pair as no-ops (`provideWakeHint: async () => {}`, `consumeWakeHint: async () => true`) — no parameter lies, no thundering-herd protection, but everything else still works.

Implementation varies by adapter:

- **Redis**: Lua scripts. `PROVIDE_WAKE_HINT_SCRIPT` reads the current value and writes `current + count` with a 60s TTL refresh; `CONSUME_WAKE_HINT_SCRIPT` performs the atomic decrement with graceful-degradation on missing keys.
- **NATS with JetStream KV**: revision-based CAS retry loops for both add and decrement.
- **PostgreSQL / NATS without KV**: hint methods are no-ops; every listener wakes and the database (FOR UPDATE SKIP LOCKED in `acquireJob`) handles contention.
- **In-process**: synchronous counter operations on a `Map<typeName, count>`.

Atomicity note: `provideWakeHint` and `notifyJobScheduled` are two separate calls. If `notifyJobScheduled` fails after `provideWakeHint` succeeds, the budget is consumed by the _next_ notification for that typeName (slight over-wake on the next batch, harmless). If `provideWakeHint` fails, the publish doesn't happen (the buffered helper short-circuits on the first throw).

### Callback Pattern

All `listen*` methods accept a callback and return a dispose function. Subscription is active when the promise resolves, and the callback is called synchronously when notifications arrive (no race condition).

## Lifecycle and Teardown

Both `StateAdapter` and `NotifyAdapter` expose `close(): Promise<void>`. The contract:

- **Idempotent** — calling `close()` a second time is a no-op.
- **Cascades into the provider when defined** — `adapter.close()` invokes `provider.close?.()`. Provider `close` is optional, so pass-through providers (postgres.js state, `pg.Pool` state, `better-sqlite3`/`node:sqlite` state, postgres.js notify, user-owned redis clients) simply omit it. Only providers that own resources beyond the caller-supplied client/pool (e.g. the `pg.Pool` notify provider with its dedicated LISTEN client) need to implement it.
- **Force-tears shared listeners** — `NotifyAdapter.close()` tears down the pg/redis/nats shared-listener multiplex regardless of remaining callbacks, waits for any in-flight `subscribe` to complete, then releases the provider's dedicated LISTEN/subscribe client.
- **Post-close behavior** — after close, `notify*`/`listen*`/`publish`/`subscribe` reject. Previously returned unsubscribe functions are safe to call (no-op).

Recommended teardown order:

```ts
await stopWorker(); // 1. Stop polling, drain in-flight jobs
await notifyAdapter.close(); // 2. Unsubscribe listeners, release LISTEN client
await stateAdapter.close(); // 3. Release state-provider resources (if any)
await pool.end(); // 4. Finally, close caller-owned clients/pools
```

## ObservabilityAdapter Design

The `ObservabilityAdapter` provides two observability mechanisms:

1. **Metrics**: Methods accept primitive data types (not domain objects) for decoupling and stability. Counters, histograms, and gauges track worker lifecycle, job events, and durations.

2. **Tracing**: `startJobSpan` and `startAttemptSpan` methods return handles for managing span lifecycle. Spans follow OpenTelemetry messaging conventions with PRODUCER spans for job creation and CONSUMER spans for processing.

When no adapter is provided, a noop implementation is used automatically, making observability opt-in. See [OTEL Tracing](../otel-tracing/) for span hierarchy and [OTEL Metrics](../otel-metrics/) for available metrics. See [OTEL Internals](../otel-internals/) for adapter architecture and trace context propagation.

### Transactional Buffering

Observability events emitted inside database transactions are buffered and only flushed after the transaction commits. If the transaction rolls back, buffered events are discarded -- no misleading metrics or spans leak out. Buffering uses `TransactionHooks` -- the same mechanism that flushes notify events on commit.

**Buffered** -- events that represent write claims inside transactions:

- **Creation**: `chainCreated`, `jobCreated`, `jobBlocked`, and PRODUCER span ends from `createStateJobs`
- **Completion**: `jobCompleted`, `jobDuration`, `completeJobSpan` (workerless), `chainCompleted`, `chainDuration`, `completeBlockerSpan`, `jobUnblocked` from `finishJob`
- **Worker complete**: `jobAttemptCompleted` and continuation PRODUCER span ends from the complete transaction in `job-process`
- **Error handling**: `jobAttemptFailed` from the error-handling transaction in `job-process`

**Not buffered** -- events that either need immediate context or occur outside transactions:

- **Span starts**: Need trace context immediately for DB writes that store trace IDs
- **Events outside transactions**: `jobAttemptStarted`, `jobAttemptDuration`, `jobAttemptLeaseRenewed`, attempt span ends (these occur outside the guarded transaction)
- **Read-only observations**: `refetchJobLocked` events observe state without making write claims

### Self-Cleaning

Both `createStateJobs` and `finishJob` use `TransactionHooks` savepoints (via `withSavepoint`) to automatically roll back buffered observability events on throw, ensuring partial events from a failed operation don't accumulate in the buffer. The `checkpoint` callback on each hook definition captures the buffer position, and the savepoint restores it on rollback.

## See Also

- [OTEL Metrics](../otel-metrics/) — Counters, histograms, and gauges
- [OTEL Tracing](../otel-tracing/) — Span hierarchy and messaging conventions
- [OTEL Internals](../otel-internals/) — Adapter architecture, W3C context propagation, and transactional buffering
- [Client API](/queuert/reference/queuert/client/) — Mutation and query methods
- [In-Process Worker](../in-process-worker/) — Worker lifecycle and lease management
