# SQLite State Adapter (Multi-Worker)

Three worker processes (forked from the main process) share one SQLite database file in WAL mode and compete for jobs. The main process creates orders and their chains in one better-sqlite3 transaction; each order is processed by whichever worker acquires its job first. The processes wake each other through the IPC notify adapter, which delivers notifications over local sockets, so workers pick up new jobs and the main process sees chains complete without waiting for a poll.

## Running

```bash
pnpm install
pnpm --filter example-state-sqlite-multi-worker start
```

No external services: the database file and the IPC registry live in a temporary directory that is removed on exit.
