# MongoDB State Adapter (Native Driver)

This example demonstrates the MongoDB state adapter with the native MongoDB driver.

## What it demonstrates

- MongoDB state storage via `@queuert/mongodb`
- Integration with native MongoDB driver for database operations
- Atomic job creation within MongoDB transactions

## What it does

1. Connects to MongoDB via testcontainers
2. Creates a MongoClient connection and runs schema migrations
3. Sets up Queuert with MongoDB state adapter
4. Starts a worker that processes `send_welcome_email` jobs
5. Registers a new user and queues a welcome email job (atomically in one transaction)
6. Waits for the job to complete

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-state-mongodb-mongodb start
```
