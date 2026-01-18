# @queuert/sqlite

> **Experimental**: This adapter's API may change significantly. For production use, consider [@queuert/postgres](https://github.com/kvet/queuert/tree/main/packages/postgres).

SQLite state adapter for [Queuert](https://github.com/kvet/queuert) - a TypeScript library for database-backed job queues.

## What does this do?

[Queuert](https://github.com/kvet/queuert) stores job state in your database. This adapter lets you use **SQLite** as your job storage backend, using [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) under the hood.

The state adapter handles:

- Creating and updating jobs in SQLite tables
- Tracking job status (`pending` → `running` → `completed`)
- Managing job leases for distributed workers
- Storing job chains and blocker relationships

## When to use SQLite

- **Development & testing** - Simple setup, no external services needed
- **Small-scale deployments** - Embedded applications, CLI tools, edge functions
- **Single-process apps** - When you don't need multiple distributed workers

For production with multiple workers across machines, consider [PostgreSQL](https://github.com/kvet/queuert/tree/main/packages/postgres) or [MongoDB](https://github.com/kvet/queuert/tree/main/packages/mongodb).

## Installation

```bash
npm install @queuert/sqlite
```

**Peer dependencies:** `queuert`

## Quick Start

```typescript
import { createQueuert, defineJobTypes } from 'queuert';
import { createSqliteStateAdapter } from '@queuert/sqlite';

const jobTypes = defineJobTypes<{
  'send-email': { entry: true; input: { to: string }; output: { sent: true } };
}>();

const stateAdapter = await createSqliteStateAdapter({
  stateProvider: mySqliteStateProvider, // You provide this - see below
});

const queuert = await createQueuert({
  stateAdapter,
  jobTypeRegistry: jobTypes,
});
```

## Configuration

```typescript
const stateAdapter = await createSqliteStateAdapter({
  stateProvider: mySqliteStateProvider,
  tablePrefix: 'queuert_',              // Prefix for table names (default: "queuert_")
  idType: 'TEXT',                       // SQL type for job IDs (default: "TEXT")
  idGenerator: () => crypto.randomUUID(), // ID generator function
  connectionRetryConfig: { ... },       // Retry config for transient errors
  isTransientError: (error) => ...,     // Custom transient error detection
});
```

## State Provider

You need to implement a state provider that bridges your SQLite client with this adapter. The provider handles transaction management and SQL execution. See the [examples](https://github.com/kvet/queuert/tree/main/examples) for complete implementations.

## Exports

### Main (`.`)

- `createSqliteStateAdapter` - Factory to create SQLite state adapter
- `SqliteStateAdapter` - Type for the SQLite state adapter
- `createAsyncLock` - Re-exported from `queuert/internal`

### Testing (`./testing`)

- `extendWithStateSqlite` - Test context helper for SQLite state adapter

### Why `createAsyncLock`?

SQLite requires serialized write access. If your application performs writes outside of Queuert (e.g., in your state provider), use `createAsyncLock` to coordinate access:

```typescript
import { createAsyncLock } from '@queuert/sqlite';

const lock = createAsyncLock();

// Use the same lock in your state provider and application code
await lock(async () => {
  // Serialized database access
});
```

## Design Notes

### Single Context Type

Unlike PostgreSQL and MongoDB adapters which use separate transaction and general context types (`TTxContext` and `TContext`), SQLite uses a single context type for both. This is because SQLite connections are single-threaded and don't support concurrent transactions in the same way.

This means your state provider's `runInTransaction` and `provideContext` can use the same context type.

## Documentation

For full documentation, examples, and API reference, see the [main Queuert README](https://github.com/kvet/queuert#readme).
