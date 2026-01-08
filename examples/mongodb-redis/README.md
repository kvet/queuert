# MongoDB + Redis Example

This example demonstrates how to use Queuert with:

- **MongoDB** for state storage
- **Redis** for notifications

## What it does

1. Connects to MongoDB and Redis
2. Creates a MongoDB client and runs index migrations
3. Sets up Queuert with MongoDB state adapter and Redis notify adapter
4. Starts a worker that processes `add_pet_to_user` jobs
5. Creates a user and queues a job to add a pet (atomically in one transaction)
6. Waits for the job to complete

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter @queuert/mongodb-redis start
```
