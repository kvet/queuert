# Processing Capacity Benchmark

Job throughput along two independent axes: state adapter (with the in-process notify default) and notify adapter (with the in-process state default). Each adapter runs six scenarios, each in a separate child process for isolation:

- **Single creation** (`create-single`) — 5,000 chains created via `createChain`, one per transaction (chains/s).
- **Batched creation** (`create-batched`) — 5,000 chains created via `createChains` in batches of 100 (chains/s).
- **Completion at concurrency 1, 2, 4 and 8** (`complete-concurrency-1`, `-2`, `-4`, `-8`) — 5,000 chains are seeded (batched, not measured), then a worker with that many slots completes them; each handler opens its own transaction and calls `complete` in it (jobs/s).

## Running

Each adapter has one script per provider example, so you can compare driver implementations head-to-head on identical hardware. By default each adapter runs all six scenarios; flags can override.

```bash
pnpm start                                # all benchmarks, all six scenarios

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

pnpm start --state-sqlite-better-sqlite3 --scenario=create-single    # one scenario
```

Defaults: 5,000 chains per scenario, batch size 100. Container-based runs require Docker.
