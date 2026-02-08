# OTEL Metrics

## Overview

This document describes Queuert's OpenTelemetry metrics implementation. For the adapter interface, see [ObservabilityAdapter](observability-adapter.md). Metrics provide quantitative visibility into queue health, worker performance, and job processing throughput.

## Metric Types

Queuert uses three [OpenTelemetry metric instruments](https://opentelemetry.io/docs/concepts/signals/metrics/#metric-instruments): **Counter**, **Histogram**, and **UpDownCounter**.

## Naming Convention

All metrics follow the pattern:

```
{prefix}.{component}.{operation}[.{suboperation}]
```

**Default prefix**: `queuert`

**Components**:

- `worker` - Worker lifecycle events
- `job` - Individual job events
- `job_chain` - Chain-level events
- `job_type` - Job type aggregations
- `state_adapter` - Database adapter health
- `notify_adapter` - Notification adapter health

## Counters

### Worker Lifecycle

| Metric            | Description                  | Attributes |
| ----------------- | ---------------------------- | ---------- |
| `worker.started`  | Worker initialized and ready | `workerId` |
| `worker.error`    | Worker encountered an error  | `workerId` |
| `worker.stopping` | Worker shutdown initiated    | `workerId` |
| `worker.stopped`  | Worker stopped successfully  | `workerId` |

### Job Events

| Metric                                | Description                     | Attributes                                           |
| ------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| `job.created`                         | New job created                 | `typeName`, `chainTypeName`                          |
| `job.attempt.started`                 | Worker began processing attempt | `typeName`, `chainTypeName`, `workerId`              |
| `job.attempt.completed`               | Attempt completed successfully  | `typeName`, `chainTypeName`, `workerId`              |
| `job.attempt.failed`                  | Attempt failed (may retry)      | `typeName`, `chainTypeName`, `workerId`              |
| `job.attempt.lease_renewed`           | Worker renewed job lease        | `typeName`, `chainTypeName`, `workerId`              |
| `job.attempt.lease_expired`           | Worker's lease expired          | `typeName`, `chainTypeName`, `workerId`              |
| `job.attempt.taken_by_another_worker` | Lease conflict detected         | `typeName`, `chainTypeName`, `workerId`              |
| `job.attempt.already_completed`       | Job completed by another worker | `typeName`, `chainTypeName`, `workerId`              |
| `job.completed`                       | Job fully completed             | `typeName`, `chainTypeName`, `workerId`, `continued` |
| `job.reaped`                          | Expired lease cleaned by reaper | `typeName`, `chainTypeName`, `workerId`              |

### Chain Events

| Metric                | Description                | Attributes      |
| --------------------- | -------------------------- | --------------- |
| `job_chain.created`   | New chain started          | `chainTypeName` |
| `job_chain.completed` | Chain completed end-to-end | `chainTypeName` |

### Blocker Events

| Metric          | Description                        | Attributes                  |
| --------------- | ---------------------------------- | --------------------------- |
| `job.blocked`   | Job blocked by incomplete chains   | `typeName`, `chainTypeName` |
| `job.unblocked` | Job unblocked (blockers completed) | `typeName`, `chainTypeName` |

### Adapter Health

| Metric                           | Description                                | Attributes                  |
| -------------------------------- | ------------------------------------------ | --------------------------- |
| `state_adapter.error`            | State adapter operation failed             | `operation`                 |
| `notify_adapter.error`           | Notify adapter operation failed            | `operation`                 |
| `notify_adapter.context_absence` | Missing notify context during job creation | `typeName`, `chainTypeName` |

## Histograms

Histograms track duration distributions. The `ObservabilityAdapter` interface accepts milliseconds; the `@queuert/otel` adapter converts to seconds per [OTEL Messaging Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-metrics/):

| Metric                 | Interface | OTEL Unit | Description                        | Attributes                              |
| ---------------------- | --------- | --------- | ---------------------------------- | --------------------------------------- |
| `job_chain.duration`   | ms        | s         | Chain creation to completion       | `chainTypeName`                         |
| `job.duration`         | ms        | s         | Job creation to completion         | `typeName`, `chainTypeName`             |
| `job.attempt.duration` | ms        | s         | Individual attempt processing time | `typeName`, `chainTypeName`, `workerId` |

### Duration Hierarchy

```
job_chain.duration
├── job.duration (first job)
│   ├── job.attempt.duration (attempt 1)
│   └── job.attempt.duration (attempt 2, retry)
├── job.duration (continuation)
│   └── job.attempt.duration
└── (wait time between jobs)
```

## Gauges (UpDownCounter)

| Metric                | Description                         | Attributes             |
| --------------------- | ----------------------------------- | ---------------------- |
| `job_type.idle`       | Workers currently idle for job type | `typeName`, `workerId` |
| `job_type.processing` | Jobs currently being processed      | `typeName`, `workerId` |

See also:

- [ObservabilityAdapter](observability-adapter.md) - Interface design and methods
- [OTEL Tracing](otel-tracing.md) - Distributed tracing with spans
- [Adapters](adapters.md) - Overall adapter design philosophy
- [Worker](worker.md) - Worker lifecycle and processing
