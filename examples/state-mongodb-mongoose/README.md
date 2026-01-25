# MongoDB State Adapter (Mongoose)

This example demonstrates the MongoDB state adapter with Mongoose ODM.

## What it demonstrates

- MongoDB state storage via `@queuert/mongodb`
- Integration with Mongoose for application data operations
- Using `mongoose.connection.collection()` for Queuert operations (preserves full feature parity)
- Atomic job creation within MongoDB transactions

## What it does

1. Connects to MongoDB via testcontainers
2. Creates a Mongoose connection and runs schema migrations
3. Defines a Mongoose model for application data (users)
4. Sets up Queuert with MongoDB state adapter
5. Starts a worker that processes `send_welcome_email` jobs
6. Registers a new user (via Mongoose model) and queues a welcome email job (atomically in one transaction)
7. Waits for the job to complete

## Key Pattern

Mongoose users use `mongoose.connection.collection()` for Queuert operations:

```typescript
const stateProvider: MongoStateProvider<DbContext> = {
  getCollection: () => mongoose.connection.collection("queuert_jobs"),
  runInTransaction: async (fn) => {
    const session = await mongoose.connection.startSession();
    try {
      return await session.withTransaction(async () => fn({ session }));
    } finally {
      await session.endSession();
    }
  },
};
```

This preserves full feature parity (aggregation pipelines with `$$NOW` for server-side timestamps) while allowing Mongoose models for application data.

## Running the example

```bash
# From the monorepo root
pnpm install

# Run the example
pnpm --filter example-state-mongodb-mongoose start
```
