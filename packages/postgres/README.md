# @queuert/postgres

[![npm version](https://img.shields.io/npm/v/@queuert/postgres.svg)](https://www.npmjs.com/package/@queuert/postgres)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/kvet/queuert.svg)](https://github.com/kvet/queuert)
[![last commit](https://img.shields.io/github/last-commit/kvet/queuert.svg)](https://github.com/kvet/queuert/commits)

PostgreSQL state adapter and notify adapter for [Queuert](https://github.com/kvet/queuert) - a TypeScript library for database-backed job queues.

## What does this do?

[Queuert](https://github.com/kvet/queuert) uses adapters to store job state and coordinate workers. This package provides two adapters:

**State Adapter** - Stores jobs in PostgreSQL tables:

- Creating and updating jobs with full ACID transactions
- Tracking job status (`pending` → `running` → `completed`)
- Managing job leases with `FOR UPDATE SKIP LOCKED` for distributed workers
- Storing job chains and blocker relationships

**Notify Adapter** - Coordinates workers via PostgreSQL LISTEN/NOTIFY:

- Broadcasts job scheduling events so workers wake up immediately
- Signals chain completion for `waitForJobChainCompletion`
- Uses 3 fixed channels with payload-based filtering

## When to use PostgreSQL

- **Production deployments** - Battle-tested, ACID-compliant, scales well
- **Distributed workers** - Multiple workers across machines with proper locking
- **Existing PostgreSQL infrastructure** - No additional services needed if you already use PostgreSQL

For simpler setups, consider [SQLite](https://github.com/kvet/queuert/tree/main/packages/sqlite). For high-throughput pub/sub, consider [Redis](https://github.com/kvet/queuert/tree/main/packages/redis) or [NATS](https://github.com/kvet/queuert/tree/main/packages/nats) notify adapters alongside the PostgreSQL state adapter.

## Installation

```bash
npm install @queuert/postgres
```

**Peer dependencies:** `queuert`

## Quick Start

```typescript
import { createClient, createConsoleLog, defineJobTypes } from "queuert";
import { createPgStateAdapter, createPgNotifyAdapter } from "@queuert/postgres";

const jobTypes = defineJobTypes<{
  "send-email": { entry: true; input: { to: string }; output: { sent: true } };
}>();

const stateAdapter = await createPgStateAdapter({
  stateProvider: myPgStateProvider, // You provide this - see below
});

const notifyAdapter = await createPgNotifyAdapter({
  notifyProvider: myPgNotifyProvider, // You provide this - see below
});

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  registry: jobTypes,
  log: createConsoleLog(),
});
```

## Configuration

### State Adapter

```typescript
const stateAdapter = await createPgStateAdapter({
  stateProvider: myPgStateProvider,
  schema: 'queuert',                    // Schema name (default: "queuert")
  idType: 'uuid',                       // SQL type for job IDs (default: "uuid")
  idDefault: 'gen_random_uuid()',       // SQL DEFAULT expression (default: "gen_random_uuid()")
  connectionRetryConfig: { ... },       // Retry config for transient errors
  isTransientError: (error) => ...,     // Custom transient error detection
});
```

### Notify Adapter

```typescript
const notifyAdapter = await createPgNotifyAdapter({
  notifyProvider: myPgNotifyProvider,
  channelPrefix: "queuert", // Channel prefix (default: "queuert")
});
```

The notify adapter uses LISTEN/NOTIFY which is fire-and-forget. Workers have built-in polling as a fallback for reliability.

## State Provider

You need to implement a state provider that bridges your PostgreSQL client (raw `pg`, Drizzle, Prisma, etc.) with this adapter. The provider handles transaction management and SQL execution. See the [examples](https://github.com/kvet/queuert/tree/main/examples) for complete implementations.

## Exports

### Main (`.`)

- `createPgStateAdapter` - Factory to create PostgreSQL state adapter
- `PgStateAdapter` - Type for the PostgreSQL state adapter
- `PgStateProvider` - Type for the state provider interface (you implement this)
- `createPgNotifyAdapter` - Factory to create PostgreSQL notify adapter
- `PgNotifyProvider` - Type for the notify provider interface (you implement this)
- `pgLiteral` - SQL literal escaping utility for ORM compatibility (e.g., Prisma's `$queryRawUnsafe`)
- `MigrationResult` - Return type from `stateAdapter.migrateToLatest()` containing `applied`, `skipped`, and `unrecognized` migration names

### Testing (`./testing`)

- `extendWithStatePostgres` - Test context helper for PostgreSQL state adapter
- `extendWithNotifyPostgres` - Test context helper for PostgreSQL notify adapter

## Documentation

For full documentation, examples, and API reference, see the [main Queuert README](https://github.com/kvet/queuert#readme).
