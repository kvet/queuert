# Memory Footprint Measurement

Measures the memory footprint of Queuert components across all available adapters. Each measurement runs in a separate child process for complete isolation.

## Usage

```bash
# Show available measurements
pnpm start

# Run all adapter measurements (requires Docker)
pnpm start:all

# Run specific adapter measurements
pnpm start:state-postgres    # PostgreSQL state adapter
pnpm start:state-sqlite      # SQLite state adapter
pnpm start:notify-redis      # Redis notify adapter
pnpm start:notify-postgres   # PostgreSQL notify adapter
pnpm start:notify-nats       # NATS notify adapter
pnpm start:otel              # OpenTelemetry observability adapter
pnpm start:dashboard         # Dashboard
```

## What it measures

### State Adapters

Measures adapter creation overhead with real database drivers:

- **PostgreSQL** - postgres.js driver + testcontainers
- **SQLite** - better-sqlite3 driver (in-memory)

### Notify Adapters

Measures adapter creation overhead with real pub/sub drivers:

- **Redis** - node-redis driver + testcontainers
- **PostgreSQL** - postgres.js driver (LISTEN/NOTIFY) + testcontainers
- **NATS** - nats.js driver + testcontainers

### Observability

- **OpenTelemetry** - OTEL SDK + metrics adapter overhead

### Dashboard

- **Dashboard** - Embeddable web dashboard (in-process, no external deps)

## Sample results

### State Adapters

| Adapter    |  Driver | Adapter + Migrations | Client + Worker |
| ---------- | ------: | -------------------: | --------------: |
| PostgreSQL | ~183 KB |              ~282 KB |         ~113 KB |
| SQLite     |  ~79 KB |               ~43 KB |         ~139 KB |

### Notify Adapters

| Adapter    |  Driver | Adapter | Client + Worker |
| ---------- | ------: | ------: | --------------: |
| Redis      | ~437 KB |   ~9 KB |         ~130 KB |
| PostgreSQL | ~184 KB |   ~9 KB |         ~236 KB |
| NATS       | ~193 KB |  ~10 KB |         ~122 KB |

### Other Components

| Component            | Heap Overhead | Notes                                        |
| -------------------- | ------------: | -------------------------------------------- |
| Observability (OTel) |       ~135 KB | Adapter only; OTel MeterProvider adds ~21 KB |
| Dashboard            |         ~2 KB | First API request loads ~1.7 MB of assets    |

## Notes

- Uses `process.memoryUsage()` for measurements
- Runs `global.gc()` twice with delay when `--expose-gc` is enabled
- Uses noop logger to avoid console noise affecting measurements
- Container-based tests require Docker to be running
- Each measurement runs in a separate child process for isolation
- Each measurement shows incremental overhead to isolate component costs
