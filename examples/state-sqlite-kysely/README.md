# SQLite State Adapter (Kysely)

This example demonstrates the SQLite state adapter with Kysely.

## What it demonstrates

- SQLite state storage via `@queuert/sqlite`
- Integration with Kysely for database operations
- Atomic job creation within Kysely transactions
- Write serialization using `createAsyncLock()`

## What it does

1. Creates an in-memory SQLite database
2. Creates a Kysely database connection with SQLite dialect
3. Sets up Queuert with SQLite state adapter
4. Starts a worker that processes `send_welcome_email` jobs
5. Registers a new user and queues a welcome email job (atomically in one transaction)
6. Waits for the job to complete

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-state-sqlite-kysely start
```
