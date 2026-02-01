# queuert

[![npm version](https://img.shields.io/npm/v/queuert.svg)](https://www.npmjs.com/package/queuert)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/kvet/queuert.svg)](https://github.com/kvet/queuert)
[![last commit](https://img.shields.io/github/last-commit/kvet/queuert.svg)](https://github.com/kvet/queuert/commits)

Core package for [Queuert](https://github.com/kvet/queuert) - a TypeScript library for database-backed job queues.

## What is Queuert?

Queuert is a **type-safe job queue library** that stores jobs in your database (PostgreSQL, SQLite, or MongoDB). It brings the familiar Promise chain pattern to distributed job processing:

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

## Installation

```bash
npm install queuert
```

This is the core package. You also need a **state adapter** to store jobs:

- [`@queuert/postgres`](https://github.com/kvet/queuert/tree/main/packages/postgres) - PostgreSQL (recommended for production)
- [`@queuert/sqlite`](https://github.com/kvet/queuert/tree/main/packages/sqlite) - SQLite _(experimental)_
- [`@queuert/mongodb`](https://github.com/kvet/queuert/tree/main/packages/mongodb) - MongoDB _(experimental)_

Optional adapters:

- [`@queuert/redis`](https://github.com/kvet/queuert/tree/main/packages/redis) - Redis notify adapter (recommended for production)
- [`@queuert/nats`](https://github.com/kvet/queuert/tree/main/packages/nats) - NATS notify adapter _(experimental)_
- [`@queuert/otel`](https://github.com/kvet/queuert/tree/main/packages/otel) - OpenTelemetry metrics

## Quick Start

```typescript
import { createClient, createInProcessWorker, defineJobTypes } from "queuert";
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
  stateAdapter,
  registry: jobTypes,
  workerId: "worker-1",
  processors: {
    "send-email": {
      attemptHandler: async ({ job, complete }) => {
        await sendEmail(job.input.to, job.input.subject);
        return complete(() => ({ sent: true }));
      },
    },
  },
});

await worker.start();

// Start a job chain (within your database transaction)
// Use your database client's transaction mechanism and pass the context
await client.withNotify(async () =>
  db.transaction(async (tx) =>
    client.startJobChain({
      tx, // Transaction context - matches your stateProvider's TTxContext
      typeName: "send-email",
      input: { to: "user@example.com", subject: "Hello!" },
    }),
  ),
);
```

## Worker Configuration

```typescript
const worker = await createInProcessWorker({
  stateAdapter,
  registry: jobTypes,
  workerId: "worker-1", // Unique worker identifier (optional)
  concurrency: 10, // Number of jobs to process in parallel (default: 1)
  processDefaults: {
    pollIntervalMs: 60_000, // How often to poll for new jobs (default: 60s)

    // Retry configuration for failed job attempts
    retryConfig: {
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
  processors: {
    // ... job type processors
  },
});

await worker.start();
```

Per-job-type configuration:

```typescript
const worker = await createInProcessWorker({
  stateAdapter,
  registry: jobTypes,
  processors: {
    'long-running-job': {
      retryConfig: { initialDelayMs: 30_000, multiplier: 2.0, maxDelayMs: 600_000 },
      leaseConfig: { leaseMs: 300_000, renewIntervalMs: 60_000 },
      attemptHandler: async ({ job, complete }) => { ... },
    },
  },
});

await worker.start();
```

## Logging

By default, Queuert operates silently with no logging. For visibility into job processing, you can enable logging:

```typescript
import { createConsoleLog, createClient, createInProcessWorker } from "queuert";

const log = createConsoleLog();

const client = await createClient({ stateAdapter, registry, log });
const worker = await createInProcessWorker({ stateAdapter, registry, log, processors });
```

For production, integrate with your logging library (Pino, Winston, etc.) by implementing a custom `Log` function. See the `log-console`, `log-pino`, and `log-winston` examples.

## Exports

### Main (`.`)

**Factories:**

- `createClient` - Create a Queuert client for job chain management
- `createInProcessWorker` - Create an in-process worker for job processing
- `createConsoleLog` - Simple console logger for development
- `defineJobTypes` - Define job types with compile-time type safety
- `createJobTypeRegistry` - Create a registry with runtime validation

**Types:**

- `Log` - Logger interface for custom logging implementations

**Adapter interfaces:**

- `StateAdapter` - Database operations for job persistence
- `NotifyAdapter` - Pub/sub notifications for job scheduling
- `ObservabilityAdapter` - Metrics and observability

**Job types:**

- `Job`, `JobWithoutBlockers` - Job entity types
- `CompletedJob` - Status-narrowed job type for completed jobs
- `JobChain`, `CompletedJobChain` - Job chain types

**Configuration:**

- `ScheduleOptions` - Deferred job scheduling (`{ at: Date }` or `{ afterMs: number }`)
- `DeduplicationOptions`, `DeduplicationScope` - Chain deduplication
- `LeaseConfig`, `RetryConfig`, `BackoffConfig` - Worker configuration
- `TypedAbortSignal`, `JobAbortReason` - Typed abort signal for process functions
- `JobAttemptMiddleware` - Middleware type for wrapping job attempt processing

**Error classes:**

- `JobNotFoundError` - Job or chain not found
- `JobAlreadyCompletedError` - Job was already completed
- `JobTakenByAnotherWorkerError` - Another worker took the job
- `JobTypeValidationError` - Runtime validation failed (with `code` and `details`)
- `JobTypeValidationErrorCode` - Error code type for `JobTypeValidationError`
- `WaitChainTimeoutError` - Timeout waiting for chain
- `RescheduleJobError` - Thrown by `rescheduleJob()` helper

**Helpers:**

- `rescheduleJob` - Reschedule a job from within a process function

**Types (Advanced):**

These types are exported for advanced use cases like building custom adapters:

- `Client` - Client instance type
- `InProcessWorker` - Worker instance type
- `JobTypeReference` - Type for nominal/structural job type references
- `JobTypeRegistryConfig` - Configuration type for `createJobTypeRegistry`
- `BaseJobTypeDefinition`, `BaseJobTypeDefinitions`, `DefineJobTypes` - Base definition types
- `ValidatedJobTypeDefinitions` - Compile-time validation phantom type
- `BaseTxContext` - Transaction context base type
- `GetStateAdapterJobId` - Type helper to extract job ID type from state adapter
- `StateJob` - Internal state job representation
- `InProcessWorkerProcessDefaults`, `InProcessWorkerProcessor`, `InProcessWorkerProcessors` - Worker configuration types
- `AttemptHandlerFn` - Attempt handler function type

## Documentation

For full documentation, examples, and API reference, see the [main Queuert README](https://github.com/kvet/queuert#readme).
