# Processing Capacity Benchmark

End-to-end job throughput along two independent axes: state adapter (with the in-process notify default) and notify adapter (with the in-process state default). Measures two phases — start (chains/s) and process (jobs/s). Each run executes in a separate child process for isolation.

## Running

```bash
bun run start                       # all benchmarks

# State axis (in-process notify)
bun run start:state-in-process      # in-process state
bun run start:state-sqlite          # SQLite state
bun run start:state-postgres        # PostgreSQL state

# Notify axis (in-process state)
bun run start:notify-in-process     # in-process notify
bun run start:notify-redis          # Redis notify
bun run start:notify-postgres       # PostgreSQL notify
bun run start:notify-nats           # NATS notify

bun run start --state-sqlite --concurrency=20  # custom concurrency
```

Default: 10,000 jobs, concurrency 10. Container-based runs require Docker.
