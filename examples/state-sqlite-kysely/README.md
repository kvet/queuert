# SQLite State Adapter (Kysely)

SQLite state storage via `@queuert/sqlite` with Kysely — atomic job creation inside application transactions. Kysely's better-sqlite3 dialect uses a size-1 connection pool that already serializes writers, so no external lock is needed.

## Running

```bash
bun install
bun run --filter example-state-sqlite-kysely start
```
