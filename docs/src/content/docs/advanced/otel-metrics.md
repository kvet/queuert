---
title: OTEL Metrics
description: OpenTelemetry counters, histograms, and gauges.
sidebar:
  order: 12
---

## Overview

Queuert emits OpenTelemetry metrics through the `@queuert/otel` adapter. Users must configure their OTEL SDK with desired exporters (Prometheus, OTLP, etc.) before using the adapter. See the `ObservabilityAdapter` TSDoc for the adapter interface.

All metrics follow the naming pattern:

```
queuert.{component}.{operation}[.{suboperation}]
```

The `ObservabilityAdapter` interface accepts milliseconds; the `@queuert/otel` adapter converts duration values to seconds per [OTEL Messaging Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-metrics/).

## Counters

Attribute names follow OpenTelemetry semantic conventions (lowercase, dotted) and match the span attributes documented in [OTEL Tracing](../otel-tracing/):

- `queuert.job.type` — job type name
- `queuert.chain.type` — chain type name
- `queuert.job.continued` — boolean: `true` if the completion produced a continuation, `false` otherwise
- `queuert.adapter.operation` — adapter operation that produced an error

### Worker Lifecycle

| Metric                    | Attributes | Description                 |
| ------------------------- | ---------- | --------------------------- |
| `queuert.worker.started`  | —          | Worker started processing   |
| `queuert.worker.error`    | —          | Worker encountered an error |
| `queuert.worker.stopping` | —          | Worker received stop signal |
| `queuert.worker.stopped`  | —          | Worker fully stopped        |

### Job Lifecycle

| Metric                    | Attributes                                                        | Description                                                                                                                |
| ------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `queuert.job.created`     | `queuert.job.type`, `queuert.chain.type`                          | Job created                                                                                                                |
| `queuert.job.completed`   | `queuert.job.type`, `queuert.chain.type`, `queuert.job.continued` | Job completed (by a worker or workerless). Use `queuert.job.attempt.completed` to count only worker-processed completions. |
| `queuert.job.blocked`     | `queuert.job.type`, `queuert.chain.type`                          | Job blocked by incomplete blocker chains                                                                                   |
| `queuert.job.rescheduled` | `queuert.job.type`, `queuert.chain.type`                          | Job returned to pending: client reschedule, `complete({ reschedule })`, or retry after a failed attempt                    |
| `queuert.job.unblocked`   | `queuert.job.type`, `queuert.chain.type`                          | Job unblocked after blocker chain completed                                                                                |

### Attempt Lifecycle

| Metric                                        | Attributes                               | Description                                                           |
| --------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `queuert.job.attempt.started`                 | `queuert.job.type`, `queuert.chain.type` | Worker began processing an attempt                                    |
| `queuert.job.attempt.completed`               | `queuert.job.type`, `queuert.chain.type` | Attempt completed successfully (including `complete({ reschedule })`) |
| `queuert.job.attempt.failed`                  | `queuert.job.type`, `queuert.chain.type` | Attempt failed (may retry)                                            |
| `queuert.job.attempt.taken_by_another_worker` | `queuert.job.type`, `queuert.chain.type` | Job already claimed by another worker                                 |
| `queuert.job.attempt.already_completed`       | `queuert.job.type`, `queuert.chain.type` | Job already completed when worker tried to process it                 |
| `queuert.job.attempt.expired`                 | `queuert.job.type`, `queuert.chain.type` | Attempt expired before processing finished                            |
| `queuert.job.attempt.reclaimed`               | `queuert.job.type`, `queuert.chain.type` | Expired attempt reclaimed for retry                                   |
| `queuert.job.attempt.extended`                | `queuert.job.type`, `queuert.chain.type` | Attempt successfully extended during processing                       |

### Chain Lifecycle

| Metric                    | Attributes           | Description     |
| ------------------------- | -------------------- | --------------- |
| `queuert.chain.created`   | `queuert.chain.type` | Chain created   |
| `queuert.chain.completed` | `queuert.chain.type` | Chain completed |
| `queuert.chain.deleted`   | `queuert.chain.type` | Chain deleted   |

### Adapter Errors

| Metric                         | Attributes                  | Description                     |
| ------------------------------ | --------------------------- | ------------------------------- |
| `queuert.state_adapter.error`  | `queuert.adapter.operation` | State adapter operation failed  |
| `queuert.notify_adapter.error` | `queuert.adapter.operation` | Notify adapter operation failed |

## Histograms

Histograms track duration distributions at three levels. Unit is seconds.

| Metric                         | Attributes                               | Description                                |
| ------------------------------ | ---------------------------------------- | ------------------------------------------ |
| `queuert.chain.duration`       | `queuert.chain.type`                     | Duration from chain creation to completion |
| `queuert.job.duration`         | `queuert.job.type`, `queuert.chain.type` | Duration from job creation to completion   |
| `queuert.job.attempt.duration` | `queuert.job.type`, `queuert.chain.type` | Duration of a single attempt               |

These form a hierarchy — chain duration encompasses job durations (plus wait time between continuations), and job duration encompasses attempt durations (plus wait time between retries):

```
queuert.chain.duration
├── queuert.job.duration (head job)
│   ├── queuert.job.attempt.duration (attempt 1)
│   └── queuert.job.attempt.duration (attempt 2, retry)
├── queuert.job.duration (continuation)
│   └── queuert.job.attempt.duration
└── (wait time between jobs)
```

## UpDownCounters (Gauges)

Two gauges track real-time worker state. They are incremented/decremented via delta values.

| Metric                        | Attributes         | Description                                 |
| ----------------------------- | ------------------ | ------------------------------------------- |
| `queuert.job_type.idle`       | `queuert.job.type` | Workers currently idle for this job type    |
| `queuert.job_type.processing` | `queuert.job.type` | Jobs of this type currently being processed |

## See Also

- [OTEL Tracing](../otel-tracing/) — Span hierarchy and attributes
- [OTEL Internals](../otel-internals/) — Adapter architecture, W3C context propagation, and transactional buffering
- [Adapters](../adapters/) — Overall adapter design philosophy
- [In-Process Worker](../in-process-worker/) — Worker lifecycle and processing
