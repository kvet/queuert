# PostgreSQL State Adapter (Prisma)

PostgreSQL state storage via `@queuert/postgres` with Prisma ORM — job creation and completion inside application transactions.

## Running

```bash
pnpm install
pnpm --filter example-state-postgres-prisma prisma:generate
pnpm --filter example-state-postgres-prisma start
```

Requires Docker (uses testcontainers to start PostgreSQL). `prisma:generate` is required before the first run to generate Prisma's TypeScript client.
