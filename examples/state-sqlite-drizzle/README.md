# SQLite State Adapter (Drizzle ORM)

SQLite state storage via `@queuert/sqlite` with Drizzle ORM — job creation and completion inside application transactions, with `createAsyncRwLock()` for write serialization: the handler holds the same lock around the transaction it passes to `complete`.

## Running

```bash
pnpm install
pnpm --filter example-state-sqlite-drizzle start
```
