# Processing Capacity Benchmark

End-to-end job throughput along two independent axes: state adapter (with the in-process notify default) and notify adapter (with the in-process state default). Measures two phases — start (chains/s) and process (jobs/s). Each run executes in a separate child process for isolation.

## Running

Each adapter has one script per provider example, so you can compare driver implementations head-to-head on identical hardware.

```bash
bun run start                                # all benchmarks

# State axis (in-process notify)
bun run start:state-in-process               # in-process state
bun run start:state-sqlite-better-sqlite3    # SQLite state via better-sqlite3
bun run start:state-sqlite-node              # SQLite state via node:sqlite
bun run start:state-postgres-postgres-js     # PostgreSQL state via postgres-js
bun run start:state-postgres-pg              # PostgreSQL state via pg

# Notify axis (in-process state)
bun run start:notify-in-process              # in-process notify
bun run start:notify-redis-redis             # Redis notify via node-redis
bun run start:notify-redis-ioredis           # Redis notify via ioredis
bun run start:notify-postgres-pg             # PostgreSQL notify via pg
bun run start:notify-postgres-postgres-js    # PostgreSQL notify via postgres-js
bun run start:notify-nats-nats               # NATS notify via nats

bun run start --state-sqlite-better-sqlite3 --concurrency=20  # custom concurrency
```

Default: 10,000 jobs, concurrency 10. Container-based runs require Docker.
