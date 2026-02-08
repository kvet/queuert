# @queuert/otel

[![npm version](https://img.shields.io/npm/v/@queuert/otel.svg)](https://www.npmjs.com/package/@queuert/otel)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/kvet/queuert.svg)](https://github.com/kvet/queuert)
[![last commit](https://img.shields.io/github/last-commit/kvet/queuert.svg)](https://github.com/kvet/queuert/commits)

OpenTelemetry observability adapter for [Queuert](https://github.com/kvet/queuert) - a TypeScript library for database-backed job queues. Provides **distributed tracing** and **metrics** (worker lifecycle, job events, chain completion, adapter health) for monitoring your job queues via Prometheus, Grafana, Datadog, or any OTEL-compatible backend.

## Installation

```bash
npm install @queuert/otel
```

**Peer dependencies:** `queuert`, `@opentelemetry/api` (requires ^1.9.0)

## Quick Start

```typescript
import { createClient, createConsoleLog, defineJobTypes } from "queuert";
import { createPgStateAdapter } from "@queuert/postgres";
import { createOtelObservabilityAdapter } from "@queuert/otel";
import { metrics, trace } from "@opentelemetry/api";

// Configure your OTEL SDK first (Prometheus, OTLP, etc.)
// See: https://opentelemetry.io/docs/languages/js/getting-started/

const jobTypes = defineJobTypes<{
  "send-email": { entry: true; input: { to: string }; output: { sent: true } };
}>();

const stateAdapter = await createPgStateAdapter({ stateProvider: myPgProvider });

const observabilityAdapter = await createOtelObservabilityAdapter({
  meter: metrics.getMeter("my-app"), // Optional - metrics disabled if omitted
  tracer: trace.getTracer("my-app"), // Optional - tracing disabled if omitted
});

const client = await createClient({
  stateAdapter,
  observabilityAdapter,
  registry: jobTypes,
  log: createConsoleLog(),
});
```

## Metrics

When a `meter` is provided, the adapter emits counters, histograms, and gauges for worker lifecycle, job events, chain completion, and adapter health.

See [OTEL Metrics](https://github.com/kvet/queuert/blob/main/docs/design/otel-metrics.md) for the full list of metrics and attributes.

## Traces

When a `tracer` is provided, the adapter creates spans following OpenTelemetry messaging conventions:

- **PRODUCER spans** - Chain and job creation (end immediately)
- **CONSUMER spans** - Job attempt processing and chain completion
- **INTERNAL spans** - Prepare and complete phases within attempts

Spans include links for continuations, retries, and blocker relationships.

See [OTEL Tracing](https://github.com/kvet/queuert/blob/main/docs/design/otel-tracing.md) for the full span hierarchy and attributes.

## Exports

### Main (`.`)

- `createOtelObservabilityAdapter` - Factory to create OpenTelemetry observability adapter

## Documentation

For full documentation, examples, and API reference, see the [main Queuert README](https://github.com/kvet/queuert#readme).
