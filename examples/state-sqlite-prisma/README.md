# SQLite State Adapter (Prisma)

SQLite state storage via `@queuert/sqlite` with Prisma ORM — atomic job creation inside application transactions, with `createAsyncRwLock()` for write serialization.

## Running

```bash
pnpm install
pnpm --filter example-state-sqlite-prisma prisma:generate
pnpm --filter example-state-sqlite-prisma start
```

`prisma:generate` is required before the first run to generate Prisma's TypeScript client.
