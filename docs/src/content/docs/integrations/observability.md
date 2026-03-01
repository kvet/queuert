---
title: Observability
description: OpenTelemetry metrics and tracing for job queues.
sidebar:
  order: 4
---

Queuert provides an OpenTelemetry adapter for metrics collection. Configure your OTEL SDK with desired exporters (Prometheus, OTLP, Jaeger, etc.) before using this adapter.

```bash
npm install @queuert/otel
```

```ts
import { createOtelObservabilityAdapter } from "@queuert/otel";
import { metrics, trace } from "@opentelemetry/api";

const client = await createClient({
  stateAdapter,
  registry: jobTypes,
  observabilityAdapter: await createOtelObservabilityAdapter({
    meter: metrics.getMeter("my-app"), // Optional — metrics disabled if omitted
    tracer: trace.getTracer("my-app"), // Optional — tracing disabled if omitted
  }),
  log: createConsoleLog(),
});
```

The adapter emits:

- **Counters:** worker lifecycle, job attempts, completions, errors
- **Histograms:** job duration, chain duration, attempt duration
- **Gauges:** idle workers per job type, jobs being processed

## Adapter architecture

The `ObservabilityAdapter` interface provides pluggable observability with two mechanisms:

- **Metrics** -- Counters, histograms, and gauges for quantitative monitoring. All methods accept primitive data types (strings, numbers, booleans) rather than domain objects, decoupling observability from internal types and ensuring stability across versions.
- **Tracing** -- Distributed spans for end-to-end visibility into job chain execution. Uses a handle-based lifecycle: `startJobSpan` and `startAttemptSpan` return handles for managing span lifecycle. Spans follow OpenTelemetry messaging conventions with PRODUCER spans for job creation and CONSUMER spans for processing.

When no adapter is provided, a noop implementation is used automatically, making observability fully opt-in.

## Transactional guarantees

Observability events emitted inside database transactions are buffered and only flushed after the transaction commits. If the transaction rolls back, buffered events are discarded -- no misleading metrics or spans leak out. This uses the same `TransactionHooks` mechanism that guards other side effects like notify events.

See [observability-otel](https://github.com/kvet/queuert/tree/main/examples/observability-otel) for a complete example.

## See Also

- [OTEL Metrics](/queuert/reference/otel-metrics/) — Full list of counters, histograms, and gauges
- [OTEL Tracing](/queuert/reference/otel-tracing/) — Span hierarchy and attributes
- [Transaction Hooks](/queuert/guides/transaction-hooks/) — How buffering works
