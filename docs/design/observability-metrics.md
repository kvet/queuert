# Metrics Design

## Overview

This document describes Queuert's metrics design using OpenTelemetry. Metrics provide quantitative visibility into queue health, worker performance, and job processing throughput.

## Metric Types

Queuert uses three OpenTelemetry metric types:

| Type                      | Purpose                     | Example                            |
| ------------------------- | --------------------------- | ---------------------------------- |
| **Counter**               | Cumulative counts of events | Jobs created, attempts completed   |
| **Histogram**             | Distribution of durations   | Job processing time, chain latency |
| **Gauge** (UpDownCounter) | Current state values        | Workers idle, jobs in progress     |

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

Histograms track duration distributions in milliseconds:

| Metric                 | Unit | Description                        | Attributes                              |
| ---------------------- | ---- | ---------------------------------- | --------------------------------------- |
| `job_chain.duration`   | ms   | Chain creation to completion       | `chainTypeName`                         |
| `job.duration`         | ms   | Job creation to completion         | `typeName`, `chainTypeName`             |
| `job.attempt.duration` | ms   | Individual attempt processing time | `typeName`, `chainTypeName`, `workerId` |

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

Histograms enable percentile analysis (p50, p95, p99), min/max tracking, and latency distribution visualization.

## Gauges

Gauges track current state using UpDownCounter (values increase and decrease):

| Metric                | Description                         | Attributes             |
| --------------------- | ----------------------------------- | ---------------------- |
| `job_type.idle`       | Workers currently idle for job type | `typeName`, `workerId` |
| `job_type.processing` | Jobs currently being processed      | `typeName`, `workerId` |

Gauges are modified with delta values (`+1` or `-1`) to track state changes.

## Attributes

All metrics include contextual attributes for multi-dimensional analysis:

### Job Attributes

| Attribute       | Type    | Description                      |
| --------------- | ------- | -------------------------------- |
| `typeName`      | string  | Job type identifier              |
| `chainTypeName` | string  | Parent chain type                |
| `workerId`      | string  | Worker processing the job        |
| `continued`     | boolean | Whether job continued to another |

### Chain Attributes

| Attribute       | Type   | Description           |
| --------------- | ------ | --------------------- |
| `chainTypeName` | string | Chain type identifier |

### Adapter Attributes

| Attribute   | Type   | Description                     |
| ----------- | ------ | ------------------------------- |
| `operation` | string | Adapter method name that failed |

## ObservabilityAdapter Interface

The core package defines the interface; `@queuert/otel` provides the implementation:

```typescript
interface ObservabilityAdapter {
  // Worker lifecycle
  workerStarted: (data: { workerId: string }) => void;
  workerError: (data: { workerId: string }) => void;
  workerStopping: (data: { workerId: string }) => void;
  workerStopped: (data: { workerId: string }) => void;

  // Job events
  jobCreated: (data: { typeName: string; chainTypeName: string }) => void;
  jobAttemptStarted: (data: JobProcessingData) => void;
  jobAttemptCompleted: (data: JobProcessingData) => void;
  jobAttemptFailed: (data: JobProcessingData) => void;
  jobCompleted: (data: JobCompletedData) => void;
  // ... additional methods

  // Durations
  jobChainDuration: (data: { chainTypeName: string; durationMs: number }) => void;
  jobDuration: (data: { typeName: string; chainTypeName: string; durationMs: number }) => void;
  jobAttemptDuration: (data: JobProcessingData & { durationMs: number }) => void;

  // Gauges
  jobTypeIdleChange: (data: { delta: number; typeName: string; workerId: string }) => void;
  jobTypeProcessingChange: (data: { delta: number; typeName: string; workerId: string }) => void;
}
```

When no `observabilityAdapter` is provided, a noop implementation is used automatically, making metrics opt-in.

## Summary

Queuert's metrics design provides:

1. **Comprehensive coverage**: Worker lifecycle, job events, chain completion, adapter health
2. **Three metric types**: Counters for events, histograms for durations, gauges for state
3. **Rich attributes**: Multi-dimensional analysis by job type, chain type, worker
4. **Consistent naming**: `{prefix}.{component}.{operation}` pattern
5. **Optional integration**: Noop default when metrics not configured

See also:

- [Tracing Design](observability-tracing.md) - Distributed tracing with spans
- [Adapters](adapters.md) - ObservabilityAdapter design philosophy
- [Worker](worker.md) - Worker lifecycle and processing
