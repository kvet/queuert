# PostgreSQL State Adapter (postgres.js)

This example demonstrates the PostgreSQL state adapter with postgres.js.

## What it demonstrates

- PostgreSQL state storage via `@queuert/postgres`
- Integration with postgres.js for database operations
- Atomic job creation within postgres.js transactions

## What it does

1. Connects to PostgreSQL
2. Creates a postgres.js connection and runs schema migrations
3. Sets up Queuert with PostgreSQL state adapter
4. Starts a worker that processes `add_pet_to_user` jobs
5. Creates a user and queues a job to add a pet (atomically in one transaction)
6. Waits for the job to complete

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-state-postgres-postgres-js start
```
