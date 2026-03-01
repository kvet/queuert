# @queuert/otel

[![npm version](https://img.shields.io/npm/v/@queuert/otel.svg)](https://www.npmjs.com/package/@queuert/otel)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/kvet/queuert.svg)](https://github.com/kvet/queuert)
[![last commit](https://img.shields.io/github/last-commit/kvet/queuert.svg)](https://github.com/kvet/queuert/commits)

OpenTelemetry observability adapter for [Queuert](https://github.com/kvet/queuert) - a TypeScript library for database-backed job queues. Provides **distributed tracing** and **metrics** (worker lifecycle, job events, chain completion, adapter health) for monitoring your job queues via Prometheus, Grafana, Datadog, or any OTEL-compatible backend.

## What does this do?

Adds OpenTelemetry observability to your Queuert job queues. Pass a `meter` for metrics, a `tracer` for distributed tracing, or both. When no adapter is provided, a noop implementation is used automatically — observability is fully opt-in.

## When to use OpenTelemetry

- **Production monitoring** — Track job throughput, error rates, and duration distributions
- **Debugging** — Trace individual job chain execution across workers
- **Alerting** — Set up alerts on job failure rates or processing latency
- **Existing OTEL infrastructure** — If you already export to Prometheus, Grafana, Datadog, etc.

## Requirements

- Node.js 22 or later

## Installation

```bash
npm install @queuert/otel
```

**Peer dependencies:** `queuert`, `@opentelemetry/api` (requires ^1.0.0)

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

See [OTEL Metrics](https://kvet.github.io/queuert/reference/otel-metrics/) for the full list of metrics and attributes.

## Traces

When a `tracer` is provided, the adapter creates spans following OpenTelemetry messaging conventions:

- **PRODUCER spans** - Chain and job creation (end immediately)
- **CONSUMER spans** - Job attempt processing and chain completion
- **INTERNAL spans** - Prepare and complete phases within attempts

Spans include links for continuations, retries, and blocker relationships.

See [OTEL Tracing](https://kvet.github.io/queuert/reference/otel-tracing/) for the full span hierarchy and attributes.

## Exports

### Main (`.`)

- `createOtelObservabilityAdapter` - Factory to create OpenTelemetry observability adapter

### Testing (`./testing`)

- `extendWithObservabilityOtel` - Test context helper for OpenTelemetry observability adapter

## Documentation

For full documentation, examples, and API reference, see the [Queuert documentation](https://kvet.github.io/queuert/).
