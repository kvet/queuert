# @queuert/mongodb

[![npm version](https://img.shields.io/npm/v/@queuert/mongodb.svg)](https://www.npmjs.com/package/@queuert/mongodb)
![experimental](https://img.shields.io/badge/status-experimental-orange.svg)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/kvet/queuert.svg)](https://github.com/kvet/queuert)
[![last commit](https://img.shields.io/github/last-commit/kvet/queuert.svg)](https://github.com/kvet/queuert/commits)

> **Experimental**: This adapter's API may change significantly. For production use, consider [@queuert/postgres](https://github.com/kvet/queuert/tree/main/packages/postgres).

MongoDB state adapter for [Queuert](https://github.com/kvet/queuert) - a TypeScript library for database-backed job queues.

## What does this do?

[Queuert](https://github.com/kvet/queuert) stores job state in your database. This adapter lets you use **MongoDB** as your job storage backend.

The state adapter handles:

- Creating and updating jobs in a `jobs` collection
- Tracking job status (`pending` → `running` → `completed`)
- Managing job leases with atomic `findOneAndUpdate` for distributed workers
- Storing job chains with embedded blocker arrays

## When to use MongoDB

- **Existing MongoDB infrastructure** - No additional services needed
- **Document-oriented data** - If your application already uses MongoDB
- **Flexible schema needs** - MongoDB's document model for job data
- **Distributed workers** - Multi-document ACID transactions (requires MongoDB 4.0+)

For SQL databases, consider [PostgreSQL](https://github.com/kvet/queuert/tree/main/packages/postgres) or [SQLite](https://github.com/kvet/queuert/tree/main/packages/sqlite).

## Installation

```bash
npm install @queuert/mongodb
```

**Peer dependencies:** `queuert`, `mongodb` (requires 6.0+)

## Quick Start

```typescript
import { createQueuertClient, createConsoleLog, defineJobTypes } from "queuert";
import { createMongoStateAdapter } from "@queuert/mongodb";

const jobTypes = defineJobTypes<{
  "send-email": { entry: true; input: { to: string }; output: { sent: true } };
}>();

const stateAdapter = await createMongoStateAdapter({
  stateProvider: myMongoStateProvider, // You provide this - see below
});

const client = await createQueuertClient({
  stateAdapter,
  registry: jobTypes,
  log: createConsoleLog(),
});
```

## Configuration

```typescript
const stateAdapter = await createMongoStateAdapter({
  stateProvider: myMongoStateProvider,
  idGenerator: () => crypto.randomUUID(), // ID generator function (default: crypto.randomUUID())
  connectionRetryConfig: { ... },         // Retry config for transient errors
  isTransientError: (error) => ...,       // Custom transient error detection
});
```

## State Provider

You need to implement a state provider that bridges your MongoDB client with this adapter:

```typescript
import { type ClientSession, type Collection } from "mongodb";

interface MongoStateProvider<TTxContext> {
  runInTransaction: <T>(fn: (txContext: TTxContext) => Promise<T>) => Promise<T>;
  getCollection: () => Collection;
  getSession: (txContext: TTxContext | undefined) => ClientSession | undefined;
}
```

- `runInTransaction`: Executes a function within a MongoDB transaction
- `getCollection`: Returns the jobs collection (without session binding)
- `getSession`: Extracts the native `ClientSession` from your transaction context

See the [examples](https://github.com/kvet/queuert/tree/main/examples) for complete implementations with native MongoDB driver and Mongoose.

## Exports

### Main (`.`)

- `createMongoStateAdapter` - Factory to create MongoDB state adapter
- `MongoStateAdapter` - Type for the MongoDB state adapter
- `MongoStateProvider` - Type for the state provider interface (you implement this)

### Testing (`./testing`)

- `extendWithStateMongodb` - Test context helper for MongoDB state adapter

## Notes

- Requires MongoDB 4.0+ for multi-document ACID transactions
- Uses a single `jobs` collection with embedded blockers array
- Uses atomic `findOneAndUpdate` for job acquisition (similar to PostgreSQL's `FOR UPDATE SKIP LOCKED`)

## Documentation

For full documentation, examples, and API reference, see the [main Queuert README](https://github.com/kvet/queuert#readme).
