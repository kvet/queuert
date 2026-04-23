# Memory Footprint Benchmark

Measures memory overhead of Queuert components across adapters. Each measurement runs in a separate child process for isolation and reports incremental overhead so component costs stay isolated.

## Running

```bash
bun run start                 # all measurements (requires Docker)
bun run start:state-postgres  # PostgreSQL state adapter
bun run start:state-sqlite    # SQLite state adapter
bun run start:notify-redis    # Redis notify adapter
bun run start:notify-postgres # PostgreSQL notify adapter
bun run start:notify-nats     # NATS notify adapter
bun run start:otel            # OpenTelemetry observability adapter
bun run start:dashboard       # Dashboard
```

Container-based measurements require Docker.
