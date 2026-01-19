# SQLite State Adapter (Drizzle ORM)

This example demonstrates the SQLite state adapter with Drizzle ORM.

## What it demonstrates

- SQLite state storage via `@queuert/sqlite`
- Integration with Drizzle ORM for database operations
- Atomic job creation within Drizzle transactions
- Write serialization using `createAsyncLock()`

## What it does

1. Creates an in-memory SQLite database
2. Creates a Drizzle database connection with better-sqlite3 dialect
3. Sets up Queuert with SQLite state adapter
4. Starts a worker that processes `send_welcome_email` jobs
5. Registers a new user and queues a welcome email job (atomically in one transaction)
6. Waits for the job to complete

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-state-sqlite-drizzle start
```
