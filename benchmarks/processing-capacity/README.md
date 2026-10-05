# Processing Capacity Benchmark

Job throughput along two independent axes: state adapter (with the in-process notify default) and notify adapter (with the in-process state default). Measures two phases — create (chains/s) and process (jobs/s). Every handler finishes in its own `stateAdapter.withTransaction`. Each adapter runs three times, each in a separate child process for isolation:

- **Batched create** — independent chains created via `createChains` (batch size 100).
- **Single create** — independent chains created via `createChain`, one per transaction.
- **Fan-in** — one pending blocker chain, then every chain created via `createChain` blocked on it. Each creation writes the blocker chain's head row before inserting its job, so the create phase shows the per-dependent cost of that write; the process phase completes the blocker, unblocks all dependents and processes them.

## Running

Each adapter has one script per provider example, so you can compare driver implementations head-to-head on identical hardware. By default each adapter runs all three; flags can override.

```bash
bun run start                                # all benchmarks, all three runs

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

bun run start --state-sqlite-better-sqlite3 --concurrency=20            # custom concurrency
bun run start --state-sqlite-better-sqlite3 --create-mode=single        # one run, single create
bun run start --state-sqlite-better-sqlite3 --scenario=fan-in           # one run, fan-in (batched create)
```

Default per run: 5,000 jobs (plus the blocker in fan-in), concurrency 10, batch size 100. Three runs by default → 15,000 chains created total per adapter. Container-based runs require Docker.
