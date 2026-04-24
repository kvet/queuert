# SQLite State Adapter (Prisma)

SQLite state storage via `@queuert/sqlite` with Prisma ORM — atomic job creation inside application transactions, with `createAsyncRwLock()` for write serialization.

## Running

```bash
bun install
bun run --filter example-state-sqlite-prisma prisma:generate
bun run --filter example-state-sqlite-prisma start
```

`prisma:generate` is required before the first run to generate Prisma's TypeScript client.
