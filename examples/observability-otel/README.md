# OpenTelemetry Observability Example

This example demonstrates how to use `@queuert/otel` for distributed tracing and metrics with OpenTelemetry.

## What it shows

1. Setting up OpenTelemetry tracing with OTLP exporter
2. Setting up OpenTelemetry metrics with OTLP exporter
3. Visualizing traces in otel-tui (terminal UI)
4. Trace hierarchy: chain → job → attempt → prepare/complete
5. Continuation links between jobs in a workflow
6. Retry attempts showing multiple spans per job

## Prerequisites

Install otel-tui (terminal UI for OpenTelemetry):

```bash
# macOS
brew install ymtdzzz/tap/otel-tui

# Or with Go
go install github.com/ymtdzzz/otel-tui@latest
```

## Running the example

```bash
# Terminal 1: Start otel-tui (OTLP receiver + viewer)
pnpm --filter example-observability-otel tui

# Terminal 2: Run the example
pnpm --filter example-observability-otel start
```

In otel-tui:

- Press `Tab` to switch between Traces/Logs/Metrics views
- Use arrow keys to navigate traces
- Press `Enter` to expand trace details

## Demo scenarios

1. **Basic chain** - Single chain with one job (`greet`)
2. **Continuations** - Chain with 3 jobs linked via continueWith (`order:validate` → `order:process` → `order:complete`)
3. **Blockers** - Main job waits for 2 parallel blocker jobs (`fetch-user` + `fetch-permissions` → `process-with-blockers`)
4. **Retry** - Job that fails first attempt, then succeeds (`might-fail`)

## Console mode (no otel-tui)

If you don't have otel-tui, you can run with console output:

```bash
pnpm --filter example-observability-otel start:console
```

## Scripts

| Script          | Description                            |
| --------------- | -------------------------------------- |
| `tui`           | Start otel-tui (OTLP receiver)         |
| `start`         | Run example (sends traces to otel-tui) |
| `start:console` | Run example (prints traces to console) |

## Key files

- `src/observability.ts` - OTEL tracing and metrics setup
- `src/index.ts` - Demo scenarios

## Telemetry collected

### Traces (spans)

- **chain** (PRODUCER) - Created when job chain starts
- **job** (PRODUCER) - Created for each job in the chain
- **attempt** (CONSUMER) - Created when worker processes job
- **prepare** (INTERNAL) - Job preparation phase
- **complete** (INTERNAL) - Job completion phase
- **chain** (CONSUMER) - Created when chain completes

### Metrics

- **Counters**: job created, attempt started/completed/failed, worker started/stopped
- **Histograms**: job duration, attempt duration, chain duration
- **Gauges**: idle workers, processing jobs per type
