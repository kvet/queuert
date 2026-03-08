# queuert

[![npm version](https://img.shields.io/npm/v/queuert.svg)](https://www.npmjs.com/package/queuert)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/kvet/queuert.svg)](https://github.com/kvet/queuert)
[![last commit](https://img.shields.io/github/last-commit/kvet/queuert.svg)](https://github.com/kvet/queuert/commits)

Core package for [Queuert](https://github.com/kvet/queuert) - a TypeScript library for database-backed job queues.

## What is Queuert?

Queuert is a **type-safe job queue library** that stores jobs in your database. It brings the familiar Promise chain pattern to distributed job processing:

```typescript
// Just like Promise chains...
fetch(url).then(process).then(format);

// Queuert chains work the same way, but persist across restarts
startJobChain({ typeName: "fetch", input: { url } });
// .continueWith('process')
// .continueWith('format')
```

Key features:

- **Type-safe** - Full TypeScript support with compile-time validation
- **Database-backed** - Jobs survive restarts; no separate queue server needed
- **Distributed** - Multiple workers can process jobs with proper locking
- **Flexible** - Linear chains, branching, loops, job dependencies (blockers)

## Requirements

- Node.js 22 or later

## Installation

```bash
npm install queuert
```

This is the core package. You also need a **state adapter** to store jobs:

- [`@queuert/postgres`](https://github.com/kvet/queuert/tree/main/packages/postgres) - PostgreSQL (recommended for production)
- [`@queuert/sqlite`](https://github.com/kvet/queuert/tree/main/packages/sqlite) - SQLite _(experimental)_

Optional adapters:

- [`@queuert/redis`](https://github.com/kvet/queuert/tree/main/packages/redis) - Redis notify adapter (recommended for production)
- [`@queuert/nats`](https://github.com/kvet/queuert/tree/main/packages/nats) - NATS notify adapter _(experimental)_
- [`@queuert/otel`](https://github.com/kvet/queuert/tree/main/packages/otel) - OpenTelemetry observability (metrics and tracing)

## Quick Start

```typescript
import {
  createClient,
  createInProcessWorker,
  defineJobTypes,
  defineJobTypeProcessorRegistry,
  withTransactionHooks,
  createTransactionHooks,
} from "queuert";
import { createSqliteStateAdapter } from "@queuert/sqlite";

// Define your job types with full type safety
const jobTypes = defineJobTypes<{
  "send-email": {
    entry: true;
    input: { to: string; subject: string };
    output: { sent: true };
  };
}>();

// Create client and adapters
const stateAdapter = await createSqliteStateAdapter({ stateProvider: myProvider });
const client = await createClient({
  stateAdapter,
  registry: jobTypes,
});

// Create a worker
const worker = await createInProcessWorker({
  client,
  workerId: "worker-1",
  processorRegistry: defineJobTypeProcessorRegistry(client, jobTypes, {
    "send-email": {
      attemptHandler: async ({ job, complete }) => {
        await sendEmail(job.input.to, job.input.subject);
        return complete(async () => ({ sent: true }));
      },
    },
  }),
});

// Start a job chain (within your database transaction)
// Use your database client's transaction mechanism and pass the context
await withTransactionHooks(async (transactionHooks) =>
  db.transaction(async (tx) =>
    client.startJobChain({
      tx, // Transaction context - matches your stateProvider's TTxContext
      transactionHooks,
      typeName: "send-email",
      input: { to: "user@example.com", subject: "Hello!" },
    }),
  ),
);
```

## Worker Configuration

```typescript
const worker = await createInProcessWorker({
  client,
  workerId: "worker-1", // Unique worker identifier (optional)
  concurrency: 10, // Number of jobs to process in parallel (default: 1)
  // Worker loop recovery backoff (separate from per-job backoff below)
  backoffConfig: {
    initialDelayMs: 1_000,
    multiplier: 2.0,
    maxDelayMs: 30_000,
  },
  processDefaults: {
    pollIntervalMs: 60_000, // How often to poll for new jobs (default: 60s)

    // Backoff configuration for failed job attempts
    backoffConfig: {
      initialDelayMs: 10_000, // Initial retry delay (default: 10s)
      multiplier: 2.0, // Exponential backoff multiplier
      maxDelayMs: 300_000, // Maximum retry delay (default: 5min)
    },

    // Lease configuration for job ownership
    leaseConfig: {
      leaseMs: 60_000, // How long a worker holds a job (default: 60s)
      renewIntervalMs: 30_000, // How often to renew the lease (default: 30s)
    },

    // Middlewares that wrap each job attempt (e.g., for contextual logging)
    attemptMiddlewares: [
      async ({ job, workerId }, next) => {
        // Setup context before job processing
        return await next();
        // Cleanup after job processing
      },
    ],
  },
  processorRegistry: defineJobTypeProcessorRegistry(client, jobTypes, {
    // ... job type processors
  }),
});
```

Per-job-type configuration:

```typescript
const worker = await createInProcessWorker({
  client,
  processorRegistry: defineJobTypeProcessorRegistry(client, jobTypes, {
    'long-running-job': {
      backoffConfig: { initialDelayMs: 30_000, multiplier: 2.0, maxDelayMs: 600_000 },
      leaseConfig: { leaseMs: 300_000, renewIntervalMs: 60_000 },
      attemptHandler: async ({ job, complete }) => { ... },
    },
  }),
});
```

## API Reference

For the full API reference with types and signatures, see the [queuert reference](https://kvet.github.io/queuert/reference/queuert/client/).

## Documentation

For full documentation and examples, see the [Queuert documentation](https://kvet.github.io/queuert/).
