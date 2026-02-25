# ObservabilityAdapter Design

## Overview

The `ObservabilityAdapter` interface provides pluggable observability for Queuert. It supports two mechanisms:

1. **Metrics** - Counters, histograms, and gauges for quantitative monitoring
2. **Tracing** - Distributed spans for end-to-end visibility into job chain execution

When no adapter is provided, a noop implementation is used automatically, making observability opt-in.

## Design Principles

### Primitive Data Types

All methods accept primitive data types (strings, numbers, booleans) rather than domain objects. This:

- Decouples observability from internal types
- Ensures stability across versions
- Simplifies adapter implementations

## Implementations

### Noop (Default)

The core package provides a noop implementation that does nothing. This is used when no adapter is configured.

### OpenTelemetry

The `@queuert/otel` package provides an OpenTelemetry implementation:

- **Metrics**: Emits counters, histograms, and gauges via OTEL Meter API
- **Tracing**: Creates spans with proper parent/child relationships and links

See:

- [OTEL Metrics](otel-metrics.md) - Metric names, attributes, and conventions
- [OTEL Tracing](otel-tracing.md) - Span hierarchy, attributes, and context propagation

## Transactional Guarantees

Observability events emitted inside database transactions are **buffered** and only flushed after the transaction commits. If the transaction rolls back, buffered events are discarded — no misleading metrics, spans, or logs leak out.

### What Is Buffered

Events that represent **write claims** inside transactions:

- **Creation**: `jobChainCreated`, `jobCreated`, `jobBlocked`, and PRODUCER span ends from `createStateJob`
- **Completion**: `jobCompleted`, `jobDuration`, `completeJobSpan` (workerless), `jobChainCompleted`, `jobChainDuration`, `completeBlockerSpan`, `jobUnblocked` from `finishJob`
- **Worker complete**: `jobAttemptCompleted` and continuation PRODUCER span ends from the complete transaction in `job-process`
- **Error handling**: `jobAttemptFailed` from the error-handling transaction in `job-process`

### What Is NOT Buffered

- **Span starts**: Need trace context immediately for DB writes that store trace IDs
- **Events outside transactions**: `jobAttemptStarted`, `jobAttemptDuration`, `jobAttemptLeaseRenewed`, attempt span ends (these occur outside the guarded transaction)
- **Read-only observations**: `refetchJobForUpdate` events observe state without making write claims

### Self-Cleaning

Both `createStateJob` and `finishJob` snapshot the observability buffer on entry and rollback on throw, ensuring partial events from a failed operation don't accumulate in the buffer.

### Implementation

Buffering uses `TransactionHooks` — the same mechanism that flushes side effects on commit and discards them on rollback. See [Transaction Hooks](transaction-hooks.md).

## Summary

The ObservabilityAdapter interface provides:

1. **Pluggable design** - Swap implementations without changing core code
2. **Opt-in observability** - Noop default when not configured
3. **Dual mechanisms** - Both metrics and tracing in one interface
4. **Handle-based tracing** - Clean lifecycle management for spans
5. **Primitive types** - Decoupled from internal domain objects

See also:

- [Adapters](adapters.md) - Overall adapter design philosophy
- [In-Process Worker](in-process-worker.md) - Worker lifecycle and processing
