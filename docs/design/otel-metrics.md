# OTEL Metrics

## Overview

This document describes Queuert's OpenTelemetry metrics implementation. For the adapter interface, see [ObservabilityAdapter](observability-adapter.md). Metrics provide quantitative visibility into queue health, worker performance, and job processing throughput.

## Metric Types

Queuert uses three [OpenTelemetry metric instruments](https://opentelemetry.io/docs/concepts/signals/metrics/#metric-instruments): **Counter**, **Histogram**, and **UpDownCounter**.

## Naming Convention

All metrics follow the pattern:

```
queuert.{component}.{operation}[.{suboperation}]
```

**Components**:

- `worker` - Worker lifecycle events
- `job` - Individual job events
- `job_chain` - Chain-level events
- `job_type` - Job type aggregations
- `state_adapter` - Database adapter health
- `notify_adapter` - Notification adapter health

## Counters

### Worker Lifecycle

| Metric                    | Description                  | Attributes |
| ------------------------- | ---------------------------- | ---------- |
| `queuert.worker.started`  | Worker initialized and ready | `workerId` |
| `queuert.worker.error`    | Worker encountered an error  | `workerId` |
| `queuert.worker.stopping` | Worker shutdown initiated    | `workerId` |
| `queuert.worker.stopped`  | Worker stopped successfully  | `workerId` |

### Job Events

| Metric                                        | Description                     | Attributes                                           |
| --------------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| `queuert.job.created`                         | New job created                 | `typeName`, `chainTypeName`                          |
| `queuert.job.attempt.started`                 | Worker began processing attempt | `typeName`, `chainTypeName`, `workerId`              |
| `queuert.job.attempt.completed`               | Attempt completed successfully  | `typeName`, `chainTypeName`, `workerId`              |
| `queuert.job.attempt.failed`                  | Attempt failed (may retry)      | `typeName`, `chainTypeName`, `workerId`              |
| `queuert.job.attempt.lease_renewed`           | Worker renewed job lease        | `typeName`, `chainTypeName`, `workerId`              |
| `queuert.job.attempt.lease_expired`           | Worker's lease expired          | `typeName`, `chainTypeName`, `workerId`              |
| `queuert.job.attempt.taken_by_another_worker` | Lease conflict detected         | `typeName`, `chainTypeName`, `workerId`              |
| `queuert.job.attempt.already_completed`       | Job completed by another worker | `typeName`, `chainTypeName`, `workerId`              |
| `queuert.job.completed`                       | Job fully completed             | `typeName`, `chainTypeName`, `workerId`, `continued` |
| `queuert.job.reaped`                          | Expired lease cleaned by reaper | `typeName`, `chainTypeName`, `workerId`              |

### Chain Events

| Metric                        | Description                | Attributes      |
| ----------------------------- | -------------------------- | --------------- |
| `queuert.job_chain.created`   | New chain started          | `chainTypeName` |
| `queuert.job_chain.completed` | Chain completed end-to-end | `chainTypeName` |

### Blocker Events

| Metric                  | Description                        | Attributes                  |
| ----------------------- | ---------------------------------- | --------------------------- |
| `queuert.job.blocked`   | Job blocked by incomplete chains   | `typeName`, `chainTypeName` |
| `queuert.job.unblocked` | Job unblocked (blockers completed) | `typeName`, `chainTypeName` |

### Adapter Health

| Metric                                   | Description                                | Attributes                  |
| ---------------------------------------- | ------------------------------------------ | --------------------------- |
| `queuert.state_adapter.error`            | State adapter operation failed             | `operation`                 |
| `queuert.notify_adapter.error`           | Notify adapter operation failed            | `operation`                 |
| `queuert.notify_adapter.context_absence` | Missing notify context during job creation | `typeName`, `chainTypeName` |

## Histograms

Histograms track duration distributions. The `ObservabilityAdapter` interface accepts milliseconds; the `@queuert/otel` adapter converts to seconds per [OTEL Messaging Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-metrics/):

| Metric                         | Interface | OTEL Unit | Description                        | Attributes                              |
| ------------------------------ | --------- | --------- | ---------------------------------- | --------------------------------------- |
| `queuert.job_chain.duration`   | ms        | s         | Chain creation to completion       | `chainTypeName`                         |
| `queuert.job.duration`         | ms        | s         | Job creation to completion         | `typeName`, `chainTypeName`             |
| `queuert.job.attempt.duration` | ms        | s         | Individual attempt processing time | `typeName`, `chainTypeName`, `workerId` |

### Duration Hierarchy

```
queuert.job_chain.duration
├── queuert.job.duration (first job)
│   ├── queuert.job.attempt.duration (attempt 1)
│   └── queuert.job.attempt.duration (attempt 2, retry)
├── queuert.job.duration (continuation)
│   └── queuert.job.attempt.duration
└── (wait time between jobs)
```

## Gauges (UpDownCounter)

| Metric                        | Description                         | Attributes             |
| ----------------------------- | ----------------------------------- | ---------------------- |
| `queuert.job_type.idle`       | Workers currently idle for job type | `typeName`, `workerId` |
| `queuert.job_type.processing` | Jobs currently being processed      | `typeName`, `workerId` |

See also:

- [ObservabilityAdapter](observability-adapter.md) - Interface design and methods
- [OTEL Tracing](otel-tracing.md) - Distributed tracing with spans
- [Adapters](adapters.md) - Overall adapter design philosophy
- [Worker](worker.md) - Worker lifecycle and processing
