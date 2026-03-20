---
title: OTEL Metrics
description: OpenTelemetry counters, histograms, and gauges.
sidebar:
  order: 11
---

## Overview

Queuert emits OpenTelemetry metrics through the `@queuert/otel` adapter. Users must configure their OTEL SDK with desired exporters (Prometheus, OTLP, etc.) before using the adapter. See the `ObservabilityAdapter` TSDoc for the adapter interface.

All metrics follow the naming pattern:

```
queuert.{component}.{operation}[.{suboperation}]
```

The `ObservabilityAdapter` interface accepts milliseconds; the `@queuert/otel` adapter converts duration values to seconds per [OTEL Messaging Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-metrics/).

## Counters

### Worker Lifecycle

| Metric | Attributes | Description |
| --- | --- | --- |
| `queuert.worker.started` | `workerId` | Worker started processing |
| `queuert.worker.error` | `workerId` | Worker encountered an error |
| `queuert.worker.stopping` | `workerId` | Worker received stop signal |
| `queuert.worker.stopped` | `workerId` | Worker fully stopped |

### Job Lifecycle

| Metric | Attributes | Description |
| --- | --- | --- |
| `queuert.job.created` | `typeName`, `chainTypeName` | Job created |
| `queuert.job.completed` | `typeName`, `chainTypeName`, `workerId`, `continued` | Job completed. `workerId` is `"null"` for workerless completion. `continued` is `"true"`/`"false"` |
| `queuert.job.reaped` | `typeName`, `chainTypeName`, `workerId` | Stale job reclaimed by reaper |
| `queuert.job.blocked` | `typeName`, `chainTypeName` | Job blocked by pending blocker chains |
| `queuert.job.unblocked` | `typeName`, `chainTypeName` | Job unblocked after blocker chain completed |

### Attempt Lifecycle

| Metric | Attributes | Description |
| --- | --- | --- |
| `queuert.job.attempt.started` | `typeName`, `chainTypeName`, `workerId` | Worker began processing an attempt |
| `queuert.job.attempt.completed` | `typeName`, `chainTypeName`, `workerId` | Attempt completed successfully |
| `queuert.job.attempt.failed` | `typeName`, `chainTypeName`, `workerId` | Attempt failed (may retry) |
| `queuert.job.attempt.taken_by_another_worker` | `typeName`, `chainTypeName`, `workerId` | Job already leased by another worker |
| `queuert.job.attempt.already_completed` | `typeName`, `chainTypeName`, `workerId` | Job already completed when worker tried to process it |
| `queuert.job.attempt.lease_expired` | `typeName`, `chainTypeName`, `workerId` | Lease expired before attempt finished |
| `queuert.job.attempt.lease_renewed` | `typeName`, `chainTypeName`, `workerId` | Lease successfully renewed during processing |

### Job Chain Lifecycle

| Metric | Attributes | Description |
| --- | --- | --- |
| `queuert.job_chain.created` | `chainTypeName` | Job chain created |
| `queuert.job_chain.completed` | `chainTypeName` | Job chain completed |

### Adapter Errors

| Metric | Attributes | Description |
| --- | --- | --- |
| `queuert.state_adapter.error` | `operation` | State adapter operation failed |
| `queuert.notify_adapter.error` | `operation` | Notify adapter operation failed |

## Histograms

Histograms track duration distributions at three levels. Unit is seconds.

| Metric | Attributes | Description |
| --- | --- | --- |
| `queuert.job_chain.duration` | `chainTypeName` | Duration from chain creation to completion |
| `queuert.job.duration` | `typeName`, `chainTypeName` | Duration from job creation to completion |
| `queuert.job.attempt.duration` | `typeName`, `chainTypeName`, `workerId` | Duration of a single attempt |

These form a hierarchy — chain duration encompasses job durations (plus wait time between continuations), and job duration encompasses attempt durations (plus wait time between retries):

```
queuert.job_chain.duration
├── queuert.job.duration (first job)
│   ├── queuert.job.attempt.duration (attempt 1)
│   └── queuert.job.attempt.duration (attempt 2, retry)
├── queuert.job.duration (continuation)
│   └── queuert.job.attempt.duration
└── (wait time between jobs)
```

## UpDownCounters (Gauges)

Two gauges track real-time worker state. They are incremented/decremented via delta values.

| Metric | Attributes | Description |
| --- | --- | --- |
| `queuert.job_type.idle` | `typeName`, `workerId` | Workers currently idle for this job type |
| `queuert.job_type.processing` | `typeName`, `workerId` | Jobs of this type currently being processed |

## See Also

- [OTEL Tracing](../otel-tracing/) — Span hierarchy and attributes
- [OTEL Internals](../otel-internals/) — Adapter architecture, W3C context propagation, and transactional buffering
- [Adapters](../adapters/) — Overall adapter design philosophy
- [In-Process Worker](../in-process-worker/) — Worker lifecycle and processing
