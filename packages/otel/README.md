# @queuert/otel

[![npm version](https://img.shields.io/npm/v/@queuert/otel.svg)](https://www.npmjs.com/package/@queuert/otel)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/kvet/queuert.svg)](https://github.com/kvet/queuert)
[![last commit](https://img.shields.io/github/last-commit/kvet/queuert.svg)](https://github.com/kvet/queuert/commits)

OpenTelemetry observability adapter for [Queuert](https://github.com/kvet/queuert) - a TypeScript library for database-backed job queues.

## What does this do?

[Queuert](https://github.com/kvet/queuert) supports pluggable observability. This adapter emits **OpenTelemetry metrics** for monitoring your job queues.

The observability adapter tracks:

- **Worker lifecycle** - Started, stopped, errors
- **Job metrics** - Created, completed, failed, retried
- **Chain metrics** - Chain creation and completion with duration histograms
- **Adapter health** - State adapter and notify adapter errors

## When to use this

- **Production monitoring** - Track queue health, throughput, and latency
- **Alerting** - Set up alerts on job failures, queue depth, or worker errors
- **Existing OTEL infrastructure** - Integrates with Prometheus, Grafana, Datadog, etc.

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
import { metrics } from "@opentelemetry/api";

// Configure your OTEL SDK first (Prometheus, OTLP, etc.)
// See: https://opentelemetry.io/docs/languages/js/getting-started/

const jobTypes = defineJobTypes<{
  "send-email": { entry: true; input: { to: string }; output: { sent: true } };
}>();

const stateAdapter = await createPgStateAdapter({ stateProvider: myPgProvider });

const observabilityAdapter = await createOtelObservabilityAdapter({
  meter: metrics.getMeter("my-app"),
});

const client = await createClient({
  stateAdapter,
  observabilityAdapter,
  registry: jobTypes,
  log: createConsoleLog(),
});
```

## Configuration

```typescript
const observabilityAdapter = await createOtelObservabilityAdapter({
  meter: metrics.getMeter("my-app"), // OTEL Meter instance (default: metrics.getMeter("queuert"))
  metricPrefix: "queuert", // Prefix for all metric names (default: "queuert")
});
```

## Metrics Emitted

### Counters

- **Worker:** `{prefix}.worker.started`, `{prefix}.worker.error`, `{prefix}.worker.stopping`, `{prefix}.worker.stopped`
- **Job:** `{prefix}.job.created`, `{prefix}.job.attempt.started`, `{prefix}.job.attempt.taken_by_another_worker`, `{prefix}.job.attempt.already_completed`, `{prefix}.job.attempt.lease_expired`, `{prefix}.job.attempt.lease_renewed`, `{prefix}.job.attempt.failed`, `{prefix}.job.attempt.completed`, `{prefix}.job.completed`, `{prefix}.job.reaped`, `{prefix}.job.blocked`, `{prefix}.job.unblocked`
- **Job Chain:** `{prefix}.job_chain.created`, `{prefix}.job_chain.completed`
- **Adapters:** `{prefix}.notify_adapter.context_absence`, `{prefix}.notify_adapter.error`, `{prefix}.state_adapter.error`

### Histograms

- `{prefix}.job_chain.duration` - Duration from chain creation to completion (ms)
- `{prefix}.job.duration` - Duration from job creation to completion (ms)
- `{prefix}.job.attempt.duration` - Duration of attempt processing (ms)

### Gauges (UpDownCounters)

- `{prefix}.job_type.idle` - Workers idle for this job type (attributes: `typeName`, `workerId`)
- `{prefix}.job_type.processing` - Jobs of this type currently being processed (attributes: `typeName`, `workerId`)

## Exports

### Main (`.`)

- `createOtelObservabilityAdapter` - Factory to create OpenTelemetry observability adapter

## Documentation

For full documentation, examples, and API reference, see the [main Queuert README](https://github.com/kvet/queuert#readme).
