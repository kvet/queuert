# OpenTelemetry Observability Example

`@queuert/otel` wiring for distributed tracing and metrics, viewed in otel-tui.

## Prerequisites

Install otel-tui:

```bash
brew install ymtdzzz/tap/otel-tui
# or: go install github.com/ymtdzzz/otel-tui@latest
```

## Running

```bash
bun install

# Terminal 1 — start otel-tui (OTLP receiver)
bun run --filter example-observability-otel tui

# Terminal 2 — run the example
bun run --filter example-observability-otel start
```

For console output instead of otel-tui:

```bash
bun run --filter example-observability-otel start:console
```
