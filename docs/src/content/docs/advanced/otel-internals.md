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
Core operations (createStateJobs, finishJob, job-process)
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

The helper layer maps domain objects (`StateJob`, `Job`, `Chain`) to the adapter's primitive parameters. It also handles logging via the `Log` interface. This separation means the OTEL adapter never needs to import or understand Queuert's domain types.

### Noop Default

When no adapter is provided, a noop implementation is used automatically — all methods are no-ops. This makes observability opt-in with zero overhead when disabled.

## W3C Trace Context Propagation

Queuert persists trace context in the database so spans can be linked across process boundaries and time gaps (e.g., a job created by one process and processed minutes later by another).

### Storage Model

Each job stores two trace contexts as W3C traceparent strings:

| Field               | Stored On           | Purpose                                                                    |
| ------------------- | ------------------- | -------------------------------------------------------------------------- |
| `chainTraceContext` | `job` table         | Chain-level span context — used for chain completion and blocker linking   |
| `traceContext`      | `job` table         | Job-level span context — used for attempt spans and continuation linking   |
| `trace_context`     | `job_blocker` table | Blocker PRODUCER span context — used to create CONSUMER span on resolution |

### W3C Traceparent Format

All contexts are serialized as W3C traceparent strings:

```
00-{traceId(32hex)}-{spanId(16hex)}-{flags(2hex)}
```

Example: `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`

The OTEL adapter serializes `SpanContext` objects to this format for storage and deserializes them back when creating child spans.

### Context Flow

1. **Chain creation** (`startChain`): Creates PRODUCER chain span → serializes to `chainTraceContext`. Creates PRODUCER job span as child → serializes to `traceContext`. Both stored with the job in the database.

2. **Blockers**: For each blocker dependency, creates a PRODUCER `await chain` span as child of the job span → serializes to `trace_context` in the `job_blocker` table.

3. **Continuation** (`continueWith`): Reads origin job's `traceContext`, creates new PRODUCER job span as child. Inherits `chainTraceContext` from origin (chain context stays the same). New job gets its own `traceContext`.

4. **Worker processing**: Reads job's `traceContext` from database, creates CONSUMER attempt span as child. All processing spans (prepare, complete) are children of the attempt span.

5. **Blocker resolution** (`unblockJobs`): Reads PRODUCER span context from `job_blocker` table, creates CONSUMER `resolve chain` span as child of the PRODUCER — linking across processes and time.

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
- **Worker complete**: `jobAttemptCompleted`, continuation PRODUCER span ends
- **Error handling**: `jobAttemptFailed`

### Not Buffered

Events that need immediate context or occur outside transactions:

- **Span starts**: Must happen before the database write that stores the trace context
- **Events outside transactions**: `jobAttemptStarted`, `jobAttemptDuration`, `jobAttemptLeaseRenewed`, attempt span ends
- **Read-only observations**: Events that observe state without claiming writes

### Self-Cleaning via Savepoints

Both `createStateJobs` and `finishJob` use savepoints to automatically roll back buffered observability events on failure. The `TransactionHooks` system captures a checkpoint of the buffer position before each operation. If the operation throws, the savepoint restores the buffer to its checkpoint — partial events from a failed operation are discarded without affecting events from earlier successful operations in the same transaction.

### TransactionHooks

The buffering mechanism is shared with notification events (`notifyJobScheduled`, `notifyChainCompleted`). Both observability and notification events register callbacks on `TransactionHooks`, which flushes all hooks after commit so callbacks run only for committed state changes. Each hook owns its own ordering: observability events register every callback under a single shared hook key and the hook flushes them sequentially, so the order of observability events matches the order of operations. Notification events use separate hook keys and flush in parallel — order across distinct hooks is not guaranteed.

## See Also

- [OTEL Metrics](../otel-metrics/) — Counters, histograms, and gauges
- [OTEL Tracing](../otel-tracing/) — Span hierarchy and attributes
- [Adapter Architecture](../adapters/) — Transactional buffering design
- [Chain Model](../chain-model/) — Chain identity and continuation model
- [Job Processing](../job-processing/) — Prepare/complete pattern
- [In-Process Worker](../in-process-worker/) — Worker lifecycle and attempt handling
