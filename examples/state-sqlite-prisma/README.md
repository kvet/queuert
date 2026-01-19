# SQLite State Adapter (Prisma)

This example demonstrates the SQLite state adapter with Prisma ORM.

## What it demonstrates

- SQLite state storage via `@queuert/sqlite`
- Integration with Prisma ORM for database operations
- Atomic job creation within Prisma transactions
- Write serialization using `createAsyncLock`

## Prerequisites

Before running the example, you must generate the Prisma client:

```bash
pnpm prisma:generate
```

This step is required because Prisma generates TypeScript types from your schema at build time.

## What it does

1. Creates a temporary SQLite database file
2. Creates a Prisma client and runs schema migrations
3. Sets up Queuert with SQLite state adapter using `createAsyncLock` for write serialization
4. Starts a worker that processes `send_welcome_email` jobs
5. Registers a new user and queues a welcome email job (atomically in one transaction)
6. Waits for the job to complete
7. Cleans up the temporary database

## Running the example

```bash
# From the monorepo root
pnpm install

# Generate Prisma client (required before first run)
pnpm --filter example-state-sqlite-prisma prisma:generate

# Run the example
pnpm --filter example-state-sqlite-prisma start
```

## Prisma integration notes

This example includes several adaptations for SQLite and Prisma:

1. **Write serialization**: SQLite requires serialized write access. The `createAsyncLock` utility from `@queuert/sqlite` is used to coordinate database writes.

2. **Temporary database**: The example creates a temporary directory for the SQLite database file, which is cleaned up after execution.

3. **Environment variable setup**: The `DATABASE_URL` environment variable must be set before importing `PrismaClient` since Prisma reads it at import time.

4. **Transaction handling**: Prisma's `$transaction` API is used for atomic operations, with the transaction client passed to Queuert's `executeSql`.
