# Processing Capacity Benchmark

Measures end-to-end job throughput of Queuert across different state and notify adapter combinations. Each benchmark runs in a separate child process for isolation.

## Usage

```bash
# Run all combinations
pnpm start

# Run specific combinations
pnpm start:postgres          # PostgreSQL state + in-process notify
pnpm start:sqlite            # SQLite state + in-process notify
pnpm start:notify-redis      # SQLite state + Redis notify
pnpm start:notify-nats       # SQLite state + NATS notify
pnpm start:notify-postgres   # PostgreSQL state + PostgreSQL notify

# Custom concurrency
pnpm start --sqlite --concurrency=20
```

## What it measures

Two phases are measured independently:

1. **Start phase** — how fast job chains can be created (chains/s)
2. **Process phase** — how fast the worker processes jobs to completion (jobs/s)

Both phases report progress every 10% and a final summary with end-to-end throughput.

### Adapter combinations

| Benchmark         | State Adapter | Notify Adapter |
| ----------------- | ------------- | -------------- |
| `postgres`        | PostgreSQL    | in-process     |
| `sqlite`          | SQLite        | in-process     |
| `notify-redis`    | SQLite        | Redis          |
| `notify-nats`     | SQLite        | NATS           |
| `notify-postgres` | PostgreSQL    | PostgreSQL     |

## Notes

- Default: 10,000 jobs, concurrency 10
- Uses `performance.now()` for timing
- Container-based benchmarks require Docker to be running
- Each combination runs in a separate child process for isolation
