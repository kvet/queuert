# PostgreSQL State Adapter (Kysely)

This example demonstrates the PostgreSQL state adapter with Kysely.

## What it demonstrates

- PostgreSQL state storage via `@queuert/postgres`
- Integration with Kysely for database operations
- Atomic job creation within Kysely transactions

## What it does

1. Connects to PostgreSQL
2. Creates a Kysely database connection and runs schema migrations
3. Sets up Queuert with PostgreSQL state adapter
4. Starts a worker that processes `add_pet_to_user` jobs
5. Creates a user and queues a job to add a pet (atomically in one transaction)
6. Waits for the job to complete

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-state-postgres-kysely start
```
