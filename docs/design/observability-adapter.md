# ObservabilityAdapter Design

## Overview

The `ObservabilityAdapter` interface provides pluggable observability for Queuert. It supports two mechanisms:

1. **Metrics** - Counters, histograms, and gauges for quantitative monitoring
2. **Tracing** - Distributed spans for end-to-end visibility into job chain execution

When no adapter is provided, a noop implementation is used automatically, making observability opt-in.

## Design Principles

### Primitive Data Types

All methods accept primitive data types (strings, numbers, booleans) rather than domain objects. This:

- Decouples observability from internal types
- Ensures stability across versions
- Simplifies adapter implementations

## Implementations

### Noop (Default)

The core package provides a noop implementation that does nothing. This is used when no adapter is configured.

### OpenTelemetry

The `@queuert/otel` package provides an OpenTelemetry implementation:

- **Metrics**: Emits counters, histograms, and gauges via OTEL Meter API
- **Tracing**: Creates spans with proper parent/child relationships and links

See:

- [OTEL Metrics](otel-metrics.md) - Metric names, attributes, and conventions
- [OTEL Tracing](otel-tracing.md) - Span hierarchy, attributes, and context propagation

## Summary

The ObservabilityAdapter interface provides:

1. **Pluggable design** - Swap implementations without changing core code
2. **Opt-in observability** - Noop default when not configured
3. **Dual mechanisms** - Both metrics and tracing in one interface
4. **Handle-based tracing** - Clean lifecycle management for spans
5. **Primitive types** - Decoupled from internal domain objects

See also:

- [Adapters](adapters.md) - Overall adapter design philosophy
- [Worker](worker.md) - Worker lifecycle and processing
