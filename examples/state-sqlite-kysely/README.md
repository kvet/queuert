# SQLite State Adapter (Kysely)

SQLite state storage via `@queuert/sqlite` with Kysely — job creation and completion inside application transactions. Kysely's better-sqlite3 dialect uses a size-1 connection pool that already serializes writers, so no external lock is needed, for client calls or for the transaction a handler passes to `finish`.

## Running

```bash
bun install
bun run --filter example-state-sqlite-kysely start
```
