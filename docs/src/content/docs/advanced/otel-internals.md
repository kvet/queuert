---
title: OTEL Internals
description: Adapter architecture, W3C context propagation, and transactional buffering.
sidebar:
  order: 14
---

## Overview

This document describes the internal implementation of `@queuert/otel` — how the observability adapter bridges Queuert's core with the OpenTelemetry SDK, how trace context survives process boundaries via database persistence, and how transactional buffering ensures metrics and spans reflect committed state.

## Adapter Architecture

The observability system has three layers:

```
Core operations (chain creation, continuation, completion, job processing)
    ↓ calls
ObservabilityHelper (maps domain objects to primitive data)
    ↓ calls
ObservabilityAdapter (emits metrics and spans)
    ↓ implemented by
@queuert/otel (OpenTelemetry SDK integration)
```

### ObservabilityAdapter Interface

The core defines an `ObservabilityAdapter` interface with methods for:

- **Metrics**: Counters (`jobCreated`, `jobCompleted`, etc.), histograms (`jobDuration`, `jobAttemptDuration`), and gauges (`jobTypeIdleChange`, `jobTypeProcessingChange`)
- **Tracing**: Span lifecycle methods (`startJobSpan`, `startAttemptSpan`, `startBlockerSpan`, `completeBlockerSpan`, `completeJobSpan`)

All metric methods accept primitive data types (strings, numbers) rather than domain objects, keeping the adapter interface stable even as internal types evolve.

### ObservabilityHelper

The helper layer maps domain objects to the adapter's primitive parameters. It also handles logging via the `Log` interface. This separation means the OTEL adapter never needs to import or understand Queuert's domain types.

### Noop Default

When no adapter is provided, a noop implementation is used automatically — all methods are no-ops. This makes observability opt-in with zero overhead when disabled.

## W3C Trace Context Propagation

Queuert persists trace context in the database so spans can be linked across process boundaries and time gaps (e.g., a job created by one process and processed minutes later by another).

### Storage Model

Trace contexts are stored as W3C traceparent strings, one per level:

| Field               | Stored On              | Purpose                                                                    |
| ------------------- | ---------------------- | -------------------------------------------------------------------------- |
| `chainTraceContext` | `job` table, head row  | Chain-level span context — used for chain completion and blocker linking   |
| `traceContext`      | `job` table, every row | Job-level span context — used for attempt spans and continuation linking   |
| `traceContext`      | `job_blocker` table    | Blocker PRODUCER span context — used to create CONSUMER span on resolution |

### W3C Traceparent Format

All contexts are serialized as W3C traceparent strings:

```
00-{traceId(32hex)}-{spanId(16hex)}-{flags(2hex)}
```

Example: `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`

The OTEL adapter serializes `SpanContext` objects to this format for storage and deserializes them back when creating child spans.

### Context Flow

1. **Chain creation** (`createChain`): Creates PRODUCER chain span → serializes to `chainTraceContext`. Creates PRODUCER job span as child → serializes to `traceContext`.

2. **Blockers**: For each blocker dependency, creates a PRODUCER `await chain` span as child of the job span → serializes to `trace_context` in the `job_blocker` table.

3. **Continuation** (`continueWith`): Reads origin job's `traceContext`, creates new PRODUCER job span as child. Inherits `chainTraceContext` from origin (chain context stays the same). New job gets its own `traceContext`.

4. **Worker processing**: Reads job's `traceContext` from database, creates CONSUMER attempt span as child. The attempt span is the only span for the attempt; it covers the whole handler. When a job's abort signal fires, a `recordAbort` event is recorded on the attempt span with the abort reason (e.g., `worker_stopping`, `taken_by_another_worker`).

5. **Blocker resolution** (`unblockJobs`): Reads PRODUCER span context from `job_blocker` table, creates CONSUMER `complete chain` span as child of the PRODUCER — linking across processes and time. A blocker chain that is already completed when the dependent chain is created gets its CONSUMER span immediately, during creation.

6. **Chain completion**: Reads `chainTraceContext`, creates CONSUMER `complete chain` span as child of the PRODUCER chain span.

### Why Two Contexts

Separate chain and job contexts serve different roles:

- `chainTraceContext` links the chain's creation to its completion, surviving across all continuations. Every job in the chain shares the same `chainTraceContext`.
- `traceContext` links a specific job to its attempt spans and to its continuation. Each job has its own `traceContext`.

## Transactional Buffering

Observability events emitted inside database transactions are buffered and flushed only after the transaction commits. If the transaction rolls back, buffered events are discarded.

### Why Buffer

Without buffering, a rolled-back transaction could emit metrics and spans for state changes that never persisted — misleading dashboards and traces. Buffering ensures observability reflects committed state.

### Buffered Events

Events representing write claims inside transactions:

- **Creation**: `chainCreated`, `jobCreated`, `jobBlocked`, PRODUCER span ends
- **Completion**: `jobCompleted`, `jobDuration`, `completeJobSpan`, `chainCompleted`, `chainDuration`, `completeBlockerSpan`, `jobUnblocked`
- **Worker `finish`**: the completion events above, `jobRescheduled` for `finish({ reschedule })`, continuation PRODUCER span ends — buffered into the `transactionHooks` the handler passes to `finish`, so they are released only after the handler's own transaction commits

### Not Buffered

Events that need immediate context or occur outside transactions:

- **Span starts**: Must happen before the database write that stores the trace context
- **Worker-side events**: `jobAttemptStarted`, `jobAttemptDuration`, `jobAttemptExtended`, `jobAttemptCompleted`, `jobAttemptFailed`, `jobRescheduled` after a failed attempt, `jobAttemptReclaimed`, `recordAbort`, attempt span ends. The worker's own writes (acquire, heartbeat, reclaim, the post-handler reschedule) are single autocommit statements, so their events are emitted directly once the statement returns
- **Read-only observations**: Events that observe state without claiming writes

### Retried `finish`

Each `finish` call buffers its events under its own hook key on the caller's `transactionHooks`. If the handler's transaction is retried and `finish` is called again, the previous call's events are discarded — the last call wins. `TransactionHooks.withSavepoint` remains available for user code that wants buffered events to roll back with a savepoint.

### TransactionHooks

The buffering mechanism is shared with notification events (`notifyJobScheduled`, `notifyChainCompleted`). Both observability and notification events register callbacks on `TransactionHooks`, which flushes all hooks after commit so callbacks run only for committed state changes. Each hook owns its own ordering: observability events register every callback under a single shared hook key and the hook flushes them sequentially, so the order of observability events matches the order of operations. Notification events use separate hook keys and flush in parallel — order across distinct hooks is not guaranteed.

## See Also

- [OTEL Metrics](../otel-metrics/) — Counters, histograms, and gauges
- [OTEL Tracing](../otel-tracing/) — Span hierarchy and attributes
- [Adapter Architecture](../adapters/) — Transactional buffering design
- [Chain Model](../chain-model/) — Chain identity and continuation model
- [Job Processing](../job-processing/) — Attempt lifecycle and `finish`
- [In-Process Worker](../in-process-worker/) — Worker lifecycle and attempt handling
