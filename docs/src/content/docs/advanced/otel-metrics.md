---
title: OTEL Metrics
description: OpenTelemetry counters, histograms, and gauges.
sidebar:
  order: 7
---

## Overview

This document describes Queuert's OpenTelemetry metrics implementation. Metrics provide quantitative visibility into queue health, worker performance, and job processing throughput. See the `ObservabilityAdapter` TSDoc for the adapter interface.

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

## Duration Hierarchy

Histograms track duration distributions at three levels. The `ObservabilityAdapter` interface accepts milliseconds; the `@queuert/otel` adapter converts to seconds per [OTEL Messaging Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-metrics/):

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

Two gauges track real-time worker state:

- `queuert.job_type.idle` — Workers currently idle for job type
- `queuert.job_type.processing` — Jobs currently being processed

## See Also

- [OTEL Tracing](../otel-tracing/) — Distributed tracing with spans
- [Adapters](../adapters/) — Overall adapter design philosophy
- [In-Process Worker](../in-process-worker/) — Worker lifecycle and processing
