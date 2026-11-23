# SQLite State Adapter (Prisma)

SQLite state storage via `@queuert/sqlite` with Prisma ORM — job creation and completion inside application transactions, with `createAsyncRwLock()` for write serialization: the handler holds the same lock around the transaction it passes to `applyJobOutcome`.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createSqliteMigrator`: a transactional table creation and index, then non-transactional migrations for a backfill in batches and a row-by-row rewrite, through raw queries (`$executeRaw` and `$queryRaw`), since the `invoices` table is not in `schema.prisma`. The non-transactional migrations take the same `createAsyncRwLock()` write lock as the rest of the app around each write.

## Running

```bash
pnpm install
pnpm --filter example-sqlite-state-prisma prisma:generate
pnpm --filter example-sqlite-state-prisma start
```

`prisma:generate` is required before the first run to generate Prisma's TypeScript client.
