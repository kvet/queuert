# Processing Capacity Benchmark

Job throughput along two independent axes: state adapter (with the in-process notify default) and notify adapter (with the in-process state default). Measures two phases — create (chains/s) and process (jobs/s) — and runs each adapter twice across orthogonal modes:

- **Atomic run** — creates chains via `createChains` (batched, size 100), processes them atomically.
- **Staged run** — creates chains via `createChain` (single), processes them in staged mode.

The pairing is layout-only — create mode and process mode are independent in production. Folding them into one run per pair avoids doubling wall-clock while exposing all four numbers (single/batched create, atomic/staged process). Each run executes in a separate child process for isolation.

## Running

Each adapter has one script per provider example, so you can compare driver implementations head-to-head on identical hardware. By default each adapter runs both modes; flags can override.

```bash
pnpm start                                # all benchmarks, both modes

# State axis (in-process notify)
pnpm start:state-in-process               # in-process state
pnpm start:state-sqlite-better-sqlite3    # SQLite state via better-sqlite3
pnpm start:state-sqlite-node-sqlite       # SQLite state via node:sqlite
pnpm start:state-postgres-postgres-js     # PostgreSQL state via postgres-js
pnpm start:state-postgres-pg              # PostgreSQL state via pg

# Notify axis (in-process state)
pnpm start:notify-in-process              # in-process notify
pnpm start:notify-redis-redis             # Redis notify via node-redis
pnpm start:notify-redis-ioredis           # Redis notify via ioredis
pnpm start:notify-postgres-pg             # PostgreSQL notify via pg
pnpm start:notify-postgres-postgres-js    # PostgreSQL notify via postgres-js
pnpm start:notify-nats-nats               # NATS notify via nats

pnpm start --state-sqlite-better-sqlite3 --concurrency=20            # custom concurrency
pnpm start --state-sqlite-better-sqlite3 --process-mode=atomic       # single process mode
pnpm start --state-sqlite-better-sqlite3 --create-mode=single        # override pairing
```

Default per run: 5,000 jobs, concurrency 10, batch size 100. Both modes run by default → 10,000 chains created total per adapter. Container-based runs require Docker.
