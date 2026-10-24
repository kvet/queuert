# SQLite State Adapter (node:sqlite)

SQLite state storage via `@queuert/sqlite` using Node's built-in `node:sqlite` module — no external SQLite dependencies. The handler holds the provider's `createAsyncRwLock()` write lock around the transaction it passes to `complete`.

## Running

```bash
pnpm install
pnpm --filter example-state-sqlite-node-sqlite start
```

Requires Node.js ≥ 22.13.0.
