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

See the [Conformance reference](/queuert/api/conformance/readme/) for the API and the [Custom Adapters](/queuert/advanced/custom-adapters/) guide for a walkthrough.

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
- **Batch operations**: Methods accepting arrays (e.g., `deleteChains`, `addJobsBlockers`) must use batch SQL (multi-row INSERT, UPDATE with IN clause, CTEs) rather than loops

This principle ensures predictable performance and proper atomicity. Use batch SQL (multi-row INSERT, UPDATE with IN/ANY clause, CTEs) rather than loops.

### Context Architecture

The `StateAdapter` type accepts two generic parameters: `TTxContext` (transaction context containing database client/session info) and `TJobId` (the job ID type for input parameters).

The context is named `TTxContext` (transaction context) because it's exclusively used within transactions. When you call `withTransaction`, the callback receives a context that represents an active transaction.

### StateProvider Interface

Users create a `StateProvider` implementation to integrate with their database client. A state provider supplies three capabilities:

- **`withTransaction`** — wraps a callback in a database transaction, passing the transaction context (`TTxContext`) to the callback
- **`executeSql`** — executes a SQL string with optional params. When `txCtx` is provided, uses that transaction; when omitted, acquires and releases its own connection
- **`withSavepoint`** _(optional)_ — runs a callback inside a savepoint within an existing transaction; when omitted, the adapter falls back to a built-in savepoint implementation
- **`close`** _(optional)_ — only needed when the provider owns resources beyond the caller-supplied client/pool

### txCtx Semantics

Whether `txCtx` is optional depends on what the method does:

- **Mutating methods require it** (`createChains`, `createContinuationJob`, `addJobsBlockers`, `unblockJobs`, `startJobAttempt`, `extendJobAttempt`, `finishJobAttempt`, `reclaimExpiredJobAttempt`, `rescheduleJobs`, `deleteChains`). A write is never standalone in practice — it has to commit or roll back together with the caller's other writes, including the notify and observability side effects buffered on `transactionHooks`. The type enforces this, so a missing `txCtx` is a compile error rather than a silently auto-committed write.
- **Read-only methods leave it optional** (`getChains`, `getJobs`, `getJobBlockers`, `getStartAttemptDelayMs`, `listChains`, `listJobs`, `listChainJobs`, `listBlockedJobs`). With a `txCtx` the read joins the caller's transaction and sees its uncommitted writes; without one the adapter acquires its own connection, executes, and releases.
- **`lock: "exclusive"` requires it.** `getChains` and `getJobs` don't mutate rows, but a write-intent lock only lasts as long as the transaction that took it, so the parameter type pairs `lock` with a mandatory `txCtx`.

At the provider layer, `executeSql` keeps an unconditionally optional `txCtx` — that's what lets the adapter run reads on their own connection, and DDL operations (like `CREATE INDEX CONCURRENTLY`) that cannot run inside a transaction at all.

### NotifyProvider Interface

A notify provider supplies three capabilities — no transaction context, connections are managed internally:

- **`publish`** — sends a message to a channel
- **`subscribe`** — listens on a channel, calling a callback on each message; returns an unsubscribe function
- **`close`** _(optional)_ — only needed when the provider owns resources (e.g. a dedicated LISTEN client)

## NotifyAdapter Design

### Broadcast Semantics

All notifications use broadcast (pub/sub) semantics with three notify/listen pairs: job scheduling, chain completion, and attempt loss. See the `NotifyAdapter` type TSDoc for method details.

### Wake-Hint Methods

To prevent thundering herd when many workers are idle, the publisher attaches a per-typeName budget that gates how many listeners actually wake. Hints are an opt-in pair of methods on `NotifyAdapter`, both keyed by `typeName`:

```d2
...@../_classes.d2

direction: right

publisher: "Publisher\nschedules 3 jobs" { class: client; width: 200; height: 100 }

notify: |md
  **Your pub/sub**

  wake budget per typeName *(TTL 60s)*<br/>
  budget[typeName]: 3 → 2 → 1 → 0

  consumeWakeHint atomically decrements;<br/>
  returns *true* while > 0,<br/>
  *false* once exhausted.
| { class: notify }

workers: {
  class: process
  label: " "

  a: "Worker A — wakes" { class: worker }
  b: "Worker B — wakes" { class: worker }
  c: "Worker C — wakes" { class: worker }
  d: "Worker D — skips wake" { class: job-muted }
}

publisher -> notify: "provideWakeHint(t, 3)\nnotifyJobScheduled(t)" { class: flow }

notify -> workers.a: "true"  { class: flow-green }
notify -> workers.b: "true"  { class: flow-green }
notify -> workers.c: "true"  { class: flow-green }
notify -> workers.d: "false" { class: dotted }
```

- `provideWakeHint(typeName, count)` — publisher adds `count` to the budget. Composes additively across concurrent publishers (two `provideWakeHint(t, 3)` calls yield a budget of 6).
- `consumeWakeHint(typeName)` — listener atomically claims one slot. Returns `true` if a slot was claimed, or if no budget is currently tracked (graceful degradation). Returns `false` only when an explicit budget was set and is now exhausted.

Flow when scheduling N jobs of `typeName`:

1. Publisher calls `provideWakeHint(typeName, N)` followed by `notifyJobScheduled(typeName)`.
2. Each receiving worker calls `consumeWakeHint(typeName)`. The first N return `true` (worker queries the database); subsequent calls return `false` (worker skips).
3. When the hint key never existed or the TTL expired, `consumeWakeHint` falls back to `true` so listeners don't silently miss wakeups.

Adapters that don't support hints implement the pair as no-ops (`provideWakeHint: async () => {}`, `consumeWakeHint: async () => true`) — no parameter lies, no thundering-herd protection, but everything else still works.

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

- **Creation**: `chainCreated`, `jobCreated`, `jobBlocked`, and PRODUCER span ends from `createStateChains` and `continueStateJob`
- **Completion**: `jobCompleted`, `jobDuration`, `completeJobSpan` (workerless), `chainCompleted`, `chainDuration`, `completeBlockerSpan`, `jobUnblocked` from `finishJob`
- **Worker complete**: `jobAttemptCompleted` and continuation PRODUCER span ends from the complete transaction in `job-process`
- **Error handling**: `jobAttemptFailed` from the error-handling transaction in `job-process`

**Not buffered** -- events that either need immediate context or occur outside transactions:

- **Span starts**: Need trace context immediately for DB writes that store trace IDs
- **Events outside transactions**: `jobAttemptStarted`, `jobAttemptDuration`, `jobAttemptExtended`, attempt span ends (these occur outside the guarded transaction)
- **Read-only observations**: `refetchJobLocked` events observe state without making write claims

### Self-Cleaning

`createStateChains`, `continueStateJob`, and `finishJob` use `TransactionHooks` savepoints (via `withSavepoint`) to automatically roll back buffered observability events on throw, ensuring partial events from a failed operation don't accumulate in the buffer. The `checkpoint` callback on each hook definition captures the buffer position, and the savepoint restores it on rollback.

## See Also

- [OTEL Metrics](../otel-metrics/) — Counters, histograms, and gauges
- [OTEL Tracing](../otel-tracing/) — Span hierarchy and messaging conventions
- [OTEL Internals](../otel-internals/) — Adapter architecture, W3C context propagation, and transactional buffering
- [Client API](/queuert/api/core/type-aliases/client/) — Mutation and query methods
- [In-Process Worker](../in-process-worker/) — Worker lifecycle and attempt management
