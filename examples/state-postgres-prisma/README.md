# PostgreSQL State Adapter (Prisma)

PostgreSQL state storage via `@queuert/postgres` with Prisma ORM — atomic job creation inside application transactions.

## Running

```bash
bun install
bun run --filter example-state-postgres-prisma prisma:generate
bun run --filter example-state-postgres-prisma start
```

Requires Docker (uses testcontainers to start PostgreSQL). `prisma:generate` is required before the first run to generate Prisma's TypeScript client.
