# PostgreSQL state adapter (Prisma)

PostgreSQL state storage via `@queuert/postgres` with Prisma ORM — job creation and completion inside application transactions.

It also runs the application's own migrations (`src/migrations.ts`) with the experimental `createPgMigrator`: a transactional table creation, then non-transactional migrations for a concurrent index, a backfill in batches and a row-by-row rewrite, through raw queries (`$executeRaw` and `$queryRaw`), since the `invoices` table is not in `schema.prisma`.

## Running

```bash
pnpm install
pnpm --filter example-postgresql-state-prisma prisma:generate
pnpm --filter example-postgresql-state-prisma start
```

Requires Docker (uses testcontainers to start PostgreSQL). `prisma:generate` is required before the first run to generate Prisma's TypeScript client.
