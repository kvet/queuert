# SQLite State Adapter (better-sqlite3)

SQLite state storage via `@queuert/sqlite` with the better-sqlite3 driver — job creation and completion inside application transactions, with `createAsyncRwLock()` for write serialization: the handler holds the same lock around the transaction it passes to `finish`.

## Running

```bash
bun install
bun run --filter example-state-sqlite-better-sqlite3 start
```
