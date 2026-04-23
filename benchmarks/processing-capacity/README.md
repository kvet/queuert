# Processing Capacity Benchmark

End-to-end job throughput across state + notify adapter combinations. Measures two phases independently — start (chains/s) and process (jobs/s). Each combination runs in a separate child process for isolation.

## Running

```bash
bun run start                   # all combinations
bun run start:postgres          # PostgreSQL state + in-process notify
bun run start:sqlite            # SQLite state + in-process notify
bun run start:notify-redis      # SQLite state + Redis notify
bun run start:notify-nats       # SQLite state + NATS notify
bun run start:notify-postgres   # PostgreSQL state + PostgreSQL notify

bun run start --sqlite --concurrency=20  # custom concurrency
```

Default: 10,000 jobs, concurrency 10. Container-based combinations require Docker.
