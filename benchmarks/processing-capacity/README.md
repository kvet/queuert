# Processing Capacity Benchmark

Job throughput along two independent axes: state adapter (with the in-process notify default) and notify adapter (with the in-process state default). Each adapter runs five scenarios, each in a separate child process for isolation. Every scenario measures a fixed 2 s window, so a slow adapter costs the same wall time as a fast one:

- **Single creation** (`create-single`) — chains created via `createChain`, one per transaction (chains/s).
- **Batched creation** (`create-batched`) — chains created via `createChains` in batches of 100 (chains/s).
- **No-op completion at concurrency 1, 4 and 16** (`complete-noop-1`, `-4`, `-16`) — 40,000 chains are seeded (not measured), then a worker with that many slots completes them; each handler opens its own transaction and calls `complete` in it (jobs/s).

Every completion scenario starts from the same 40,000-job queue, so only concurrency varies between them. A result prefixed with `>` drained the queue before the window ended and is a lower bound.

Containers (PostgreSQL, Redis, NATS) start once per run and are shared: each scenario child gets its own PostgreSQL schema, channel prefix or subject prefix. After all runs finish, the tool prints one markdown table per scenario family (creation, no-op completion), with adapters as rows grouped by axis, ready to paste into the docs.

## Running

Each adapter has one script per provider example, so you can compare driver implementations head-to-head on identical hardware. By default each adapter runs all five scenarios; flags can override.

```bash
pnpm start                                # all benchmarks, all five scenarios

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

Defaults: 2 s measurement window, 40,000 seeded jobs per completion scenario, batch size 100. Container-based runs require Docker.
