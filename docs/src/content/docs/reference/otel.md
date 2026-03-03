---
title: "@queuert/otel"
description: OpenTelemetry observability adapter.
sidebar:
  order: 9
---

## createOtelObservabilityAdapter

```typescript
const observabilityAdapter = await createOtelObservabilityAdapter({
  meter?: Meter,    // From @opentelemetry/api — metrics disabled if omitted
  tracer?: Tracer,  // From @opentelemetry/api — tracing disabled if omitted
});
```

Returns `Promise<ObservabilityAdapter>`.

Both parameters are optional. When neither is provided, all observability operations are noops. Provide `meter` for metrics, `tracer` for distributed tracing, or both.

## See Also

- [Observability](/queuert/integrations/observability/) — Integration guide for observability
- [OTEL Metrics](/queuert/advanced/otel-metrics/) — Counters, histograms, and gauges
- [OTEL Tracing](/queuert/advanced/otel-tracing/) — Span hierarchy and messaging conventions
