# SQLite State Adapter (bun:sqlite)

SQLite state storage via `@queuert/sqlite` using Bun's built-in [`bun:sqlite`](https://bun.com/docs/runtime/sqlite) module — no external SQLite dependencies. The handler holds the provider's `createAsyncRwLock()` write lock around the transaction it passes to `finish`.

## Running

```bash
bun install
bun run --filter example-state-sqlite-bun start
```

Requires [Bun](https://bun.com).
