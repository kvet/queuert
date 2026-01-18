# Postgres (Raw pg) + ioredis Example

This example demonstrates how to use Queuert with:

- **PostgreSQL** (via raw `pg` client) for state storage
- **ioredis** for notifications

## What it does

1. Connects to PostgreSQL and Redis using ioredis
2. Creates a pg Pool connection and runs schema migrations
3. Sets up Queuert with PostgreSQL state adapter and Redis notify adapter
4. Starts a worker that processes `add_pet_to_user` jobs
5. Creates a user and queues a job to add a pet (atomically in one transaction)
6. Waits for the job to complete

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter @queuert/postgres-raw-ioredis start
```
