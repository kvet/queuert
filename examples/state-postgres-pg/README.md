# PostgreSQL State Adapter (pg)

This example demonstrates the PostgreSQL state adapter with the raw pg driver.

## What it demonstrates

- PostgreSQL state storage via `@queuert/postgres`
- Integration with raw pg driver for database operations
- Atomic job creation within pg transactions

## What it does

1. Connects to PostgreSQL
2. Creates a pg Pool connection and runs schema migrations
3. Sets up Queuert with PostgreSQL state adapter
4. Starts a worker that processes `send_welcome_email` jobs
5. Registers a new user and queues a welcome email job (atomically in one transaction)
6. Waits for the job to complete

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-state-postgres-pg start
```
