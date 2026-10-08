# SQLite State Adapter (Knex)

SQLite state storage via `@queuert/sqlite` with Knex — job creation and completion inside application transactions. Knex's better-sqlite3 dialect uses a size-1 connection pool that already serializes writers, so no external lock is needed, for client calls or for the transaction a handler passes to `finish`.

## Running

```bash
bun install
bun run --filter example-state-sqlite-knex start
```
