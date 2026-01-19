# SQLite State Adapter (better-sqlite3)

This example demonstrates the SQLite state adapter with the better-sqlite3 driver.

## What it demonstrates

- SQLite state storage via `@queuert/sqlite`
- Integration with better-sqlite3 driver for database operations
- Atomic job creation within SQLite transactions
- Write serialization using `createAsyncLock()`

## What it does

1. Creates an in-memory SQLite database
2. Creates a users table for application data
3. Sets up Queuert with SQLite state adapter
4. Starts a worker that processes `send_welcome_email` jobs
5. Registers a new user and queues a welcome email job (atomically in one transaction)
6. Waits for the job to complete

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-state-sqlite-better-sqlite3 start
```
