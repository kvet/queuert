---
title: Installation
description: Install Queuert and its adapters.
sidebar:
  order: 2
---

```bash
# Core package (required)
npm install queuert

# State adapters (pick one)
npm install @queuert/postgres  # PostgreSQL - recommended for production
npm install @queuert/sqlite    # SQLite (experimental)

# Notify adapters (optional, for reduced latency)
npm install @queuert/redis     # Redis pub/sub - recommended for production
npm install @queuert/nats      # NATS pub/sub (experimental)
# Or use PostgreSQL LISTEN/NOTIFY via @queuert/postgres (no extra infra)

# Dashboard (optional)
npm install @queuert/dashboard  # Embeddable web UI for job observation

# Observability (optional)
npm install @queuert/otel      # OpenTelemetry metrics and histograms
```

## Requirements

- Node.js 22 or later
- TypeScript 5.0+ (recommended)

## Next Steps

- [Core Concepts](/queuert/getting-started/core-concepts/) — Understand jobs, chains, types, and adapters
- [Transaction Hooks](/queuert/guides/transaction-hooks/) — How side effects are buffered during transactions
- [State Adapters](/queuert/integrations/state-adapters/) — Choose and configure your database adapter
- [examples/](https://github.com/kvet/queuert/tree/main/examples) — Browse complete working examples
