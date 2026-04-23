---
title: Logging
description: Structured log entries emitted during job and worker lifecycle events.
sidebar:
  order: 11
---

## Overview

Queuert emits structured log entries for every lifecycle event — worker start/stop, job creation, attempts, failures, completions, chain lifecycle, blockers, and adapter errors. Logging is part of `queuert` core and does not require the `@queuert/otel` package.

Pass a `log` function to `createClient` to receive log entries:

```ts
import { createClient, type Log } from "queuert";

const log: Log = (entry) => {
  console.log(`[${entry.level}] ${entry.message}`, entry.data);
};

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypes,
});
```

## Log Entry Structure

Every log entry is a typed object with the following shape:

```ts
{
  type: string;     // Machine-readable event identifier (e.g. "job_created")
  level: LogLevel;  // "info" | "warn" | "error"
  message: string;  // Human-readable description
  data: { ... };    // Structured data specific to the event
  error?: unknown;  // Present only on error/warn entries that carry an error
}
```

All entries are strongly typed — the `type` field determines the exact shape of `data`, the `level`, and the `message`. This means consumers can switch on `type` for type-safe handling.

## Log Entries

### Worker Lifecycle

| Type              | Level   | Message                 | Data                       |
| ----------------- | ------- | ----------------------- | -------------------------- |
| `worker_started`  | `info`  | Started worker          | `workerId`, `jobTypeNames` |
| `worker_error`    | `error` | Worker error            | `workerId`, `error`        |
| `worker_stopping` | `info`  | Stopping worker...      | `workerId`                 |
| `worker_stopped`  | `info`  | Worker has been stopped | `workerId`                 |

### Job Lifecycle

| Type            | Level  | Message                          | Data                                                                                                       |
| --------------- | ------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `job_created`   | `info` | Job created                      | `id`, `typeName`, `chainId`, `chainTypeName`, `input`, `blockers`, `scheduledAt?`, `scheduleAfterMs?`      |
| `job_completed` | `info` | Job completed                    | `id`, `typeName`, `chainId`, `chainTypeName`, `status`, `attempt`, `output?`, `continuedWith?`, `workerId` |
| `job_reaped`    | `info` | Reaped expired job lease         | `id`, `typeName`, `chainId`, `chainTypeName`, `leasedBy`, `leasedUntil`, `workerId`                        |
| `job_blocked`   | `info` | Job blocked by incomplete chains | `id`, `typeName`, `chainId`, `chainTypeName`, `blockedByChains`                                            |
| `job_triggered` | `info` | Job triggered                    | `id`, `typeName`, `chainId`, `chainTypeName`                                                               |
| `job_unblocked` | `info` | Job unblocked                    | `id`, `typeName`, `chainId`, `chainTypeName`, `unblockedByChain`                                           |

### Attempt Lifecycle

| Type                                  | Level   | Message                                 | Data                                                                                                                            |
| ------------------------------------- | ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `job_attempt_started`                 | `info`  | Job attempt started                     | `id`, `typeName`, `chainId`, `chainTypeName`, `status`, `attempt`, `workerId`                                                   |
| `job_attempt_completed`               | `info`  | Job attempt completed                   | `id`, `typeName`, `chainId`, `chainTypeName`, `status`, `attempt`, `output?`, `continuedWith?`, `workerId`                      |
| `job_attempt_failed`                  | `error` | Job attempt failed                      | `id`, `typeName`, `chainId`, `chainTypeName`, `status`, `attempt`, `rescheduledAfterMs?`, `rescheduledAt?`, `workerId`, `error` |
| `job_attempt_taken_by_another_worker` | `warn`  | Job taken by another worker             | `id`, `typeName`, `chainId`, `chainTypeName`, `status`, `attempt`, `leasedBy`, `leasedUntil`, `workerId`                        |
| `job_attempt_already_completed`       | `warn`  | Job already completed by another worker | `id`, `typeName`, `chainId`, `chainTypeName`, `status`, `attempt`, `completedBy`, `workerId`                                    |
| `job_attempt_lease_expired`           | `warn`  | Job lease expired                       | `id`, `typeName`, `chainId`, `chainTypeName`, `status`, `attempt`, `leasedBy`, `leasedUntil`, `workerId`                        |
| `job_attempt_lease_renewed`           | `info`  | Job lease renewed                       | `id`, `typeName`, `chainId`, `chainTypeName`, `status`, `attempt`, `leasedBy`, `leasedUntil`, `workerId`                        |

### Job Chain Lifecycle

| Type                  | Level  | Message             | Data                       |
| --------------------- | ------ | ------------------- | -------------------------- |
| `job_chain_created`   | `info` | Job chain created   | `id`, `typeName`, `input`  |
| `job_chain_completed` | `info` | Job chain completed | `id`, `typeName`, `output` |
| `job_chain_deleted`   | `info` | Job chain deleted   | `id`, `typeName`           |

### Adapter Errors

| Type                   | Level  | Message              | Data                 |
| ---------------------- | ------ | -------------------- | -------------------- |
| `notify_adapter_error` | `warn` | Notify adapter error | `operation`, `error` |
| `state_adapter_error`  | `warn` | State adapter error  | `operation`, `error` |

### Validation Errors

| Type                        | Level   | Message     | Data                                                     |
| --------------------------- | ------- | ----------- | -------------------------------------------------------- |
| `job_type_validation_error` | `error` | _(dynamic)_ | `code`, `typeName`, `error`, plus error-specific details |

## Data Shapes

Log entry data fields compose from a few base shapes:

- **JobBasicData** — `id`, `typeName`, `chainId`, `chainTypeName`
- **JobProcessingData** — extends JobBasicData with `status`, `attempt`
- **JobChainData** — `id`, `typeName`

## Relationship to ObservabilityAdapter

The `log` function and the `ObservabilityAdapter` are independent. The internal `ObservabilityHelper` calls both on each event, ensuring logs and metrics/traces stay consistent. You can use either or both:

- `log` only — structured logging without OTel dependency
- `ObservabilityAdapter` only — metrics and traces without logging
- Both — full observability

## See Also

- [OTEL Metrics](../otel-metrics/) — OpenTelemetry counters, histograms, and gauges
- [OTEL Tracing](../otel-tracing/) — Span hierarchy and distributed tracing
- [Adapters](../adapters/) — Overall adapter design philosophy
