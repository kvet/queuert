# PostgreSQL State Adapter (Prisma)

This example demonstrates the PostgreSQL state adapter with Prisma.

## What it demonstrates

- PostgreSQL state storage via `@queuert/postgres`
- Integration with Prisma ORM for database operations
- Atomic job creation within Prisma transactions

## Prerequisites

Before running the example, you must generate the Prisma client:

```bash
pnpm prisma:generate
```

This step is required because Prisma generates TypeScript types from your schema at build time.

## What it does

1. Connects to PostgreSQL
2. Creates a Prisma client and runs schema migrations
3. Sets up Queuert with PostgreSQL state adapter
4. Starts a worker that processes `add_pet_to_user` jobs
5. Creates a user and queues a job to add a pet (atomically in one transaction)
6. Waits for the job to complete

## Running the example

```bash
# From the monorepo root
pnpm install

# Generate Prisma client (required before first run)
pnpm --filter example-state-postgres-prisma prisma:generate

# Run the example
pnpm --filter example-state-postgres-prisma start
```

## Prisma integration notes

This example includes several adaptations for Prisma's limitations:

1. **Single-statement execution**: Prisma's `$queryRawUnsafe` only supports single SQL statements. The `executeSql` function splits multi-statement queries (like migrations) and executes them individually, handling PostgreSQL dollar-quoted strings (`$$ ... $$`).

2. **TEXT IDs instead of UUID**: Prisma's raw queries don't automatically cast parameters to PostgreSQL UUID type. This example uses `idType: "text"` to avoid type mismatch errors.

3. **Transaction detection**: Since Prisma doesn't expose an `isTransaction` property, we detect transactions by checking for the absence of the `$transaction` method on the client.

4. **Unified context**: The state provider uses a single `{ client: DbClient }` context type that works for both the main `PrismaClient` and transaction clients.
