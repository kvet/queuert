# OpenTelemetry Observability Example

This example demonstrates how to use `@queuert/otel` for metrics collection with OpenTelemetry.

## What it shows

1. Setting up an OpenTelemetry MeterProvider with console exporter
2. Creating the OTEL observability adapter
3. Metrics emitted during job processing (counters, histograms, gauges)

## Metrics collected

- **Counters**: job created, attempt started/completed/failed, worker started/stopped
- **Histograms**: job duration, attempt duration, chain duration
- **Gauges**: idle workers, processing jobs per type

## Key files

- `src/observability.ts` - OTEL setup and adapter configuration
- `src/index.ts` - Demo that runs jobs and exports metrics

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter @queuert/observability-otel start
```
