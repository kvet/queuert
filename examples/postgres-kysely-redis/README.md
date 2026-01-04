# Postgres (Kysely) + Redis Example

This example demonstrates how to use Queuert with:

- **PostgreSQL** (via Kysely) for state storage
- **Redis** for notifications

## What it does

1. Connects to PostgreSQL and Redis
2. Creates a Kysely database connection and runs schema migrations
3. Sets up Queuert with PostgreSQL state adapter and Redis notify adapter
4. Starts a worker that processes `add_pet_to_user` jobs
5. Creates a user and queues a job to add a pet (atomically in one transaction)
6. Waits for the job to complete

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter @queuert/postgres-kysely-redis start
```
