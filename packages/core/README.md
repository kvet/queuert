# queuert

Core package for [Queuert](https://github.com/kvet/queuert) - a TypeScript library for database-backed job queues.

## What is Queuert?

Queuert is a **type-safe job queue library** that stores jobs in your database (PostgreSQL, SQLite, or MongoDB). It brings the familiar Promise chain pattern to distributed job processing:

```typescript
// Just like Promise chains...
fetch(url).then(process).then(format);

// Queuert chains work the same way, but persist across restarts
startJobChain({ typeName: 'fetch', input: { url } })
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
import { createQueuert, defineJobTypes, createConsoleLog } from 'queuert';
import { createSqliteStateAdapter } from '@queuert/sqlite';

// Define your job types with full type safety
const jobTypes = defineJobTypes<{
  'send-email': {
    entry: true;
    input: { to: string; subject: string };
    output: { sent: true };
  };
}>();

// Create Queuert instance
const stateAdapter = await createSqliteStateAdapter({ stateProvider: myProvider });
const queuert = await createQueuert({
  stateAdapter,
  jobTypeRegistry: jobTypes,
  log: createConsoleLog(),
});

// Create a worker
const worker = queuert.createWorker();

worker.implementJobType({
  typeName: 'send-email',
  process: async ({ job, complete }) => {
    await sendEmail(job.input.to, job.input.subject);
    return complete(() => ({ sent: true }));
  },
});

await worker.start({ workerId: 'worker-1' });

// Start a job chain
await queuert.withClient(async (client) => {
  await queuert.startJobChain({
    client,
    typeName: 'send-email',
    input: { to: 'user@example.com', subject: 'Hello!' },
  });
});
```

## Worker Configuration

```typescript
await worker.start({
  workerId: 'worker-1',              // Unique worker identifier
  pollIntervalMs: 60_000,            // How often to poll for new jobs (default: 60s)
  nextJobDelayMs: 0,                 // Delay between processing jobs

  // Retry configuration for failed job attempts
  defaultRetryConfig: {
    initialDelayMs: 10_000,          // Initial retry delay (default: 10s)
    multiplier: 2.0,                 // Exponential backoff multiplier
    maxDelayMs: 300_000,             // Maximum retry delay (default: 5min)
  },

  // Lease configuration for job ownership
  defaultLeaseConfig: {
    leaseMs: 60_000,                 // How long a worker holds a job (default: 60s)
    renewIntervalMs: 30_000,         // How often to renew the lease (default: 30s)
  },

  // Middlewares that wrap each job attempt (e.g., for contextual logging)
  jobAttemptMiddlewares: [
    async ({ job, workerId }, next) => {
      // Setup context before job processing
      return await next();
      // Cleanup after job processing
    },
  ],
});
```

Per-job-type configuration:

```typescript
worker.implementJobType({
  typeName: 'long-running-job',
  retryConfig: { initialDelayMs: 30_000, multiplier: 2.0, maxDelayMs: 600_000 },
  leaseConfig: { leaseMs: 300_000, renewIntervalMs: 60_000 },
  process: async ({ job, complete }) => { ... },
});
```

## Exports

### Main (`.`)

**Factories:**

- `createQueuert` - Create a Queuert instance
- `createConsoleLog` - Simple console logger for development
- `defineJobTypes` - Define job types with compile-time type safety
- `createJobTypeRegistry` - Create a registry with runtime validation

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
- `DeduplicationOptions`, `DeduplicationStrategy` - Chain deduplication
- `LeaseConfig`, `RetryConfig`, `BackoffConfig` - Worker configuration
- `TypedAbortSignal`, `JobAbortReason` - Typed abort signal for process functions
- `JobAttemptMiddleware` - Middleware type for wrapping job attempt processing

**Error classes:**

- `JobNotFoundError` - Job or chain not found
- `JobAlreadyCompletedError` - Job was already completed
- `JobTakenByAnotherWorkerError` - Another worker took the job
- `JobTypeValidationError` - Runtime validation failed (with `code` and `details`)
- `StateNotInTransactionError` - Operation requires transaction
- `WaitForJobChainCompletionTimeoutError` - Timeout waiting for chain
- `RescheduleJobError` - Thrown by `rescheduleJob()` helper

**Helpers:**

- `rescheduleJob` - Reschedule a job from within a process function

### Testing (`./testing`)

Test suites and context helpers for adapter packages:

- Test suites: `processTestSuite`, `chainsTestSuite`, `blockerChainsTestSuite`, `deduplicationTestSuite`, `deletionTestSuite`, `notifyTestSuite`, `reaperTestSuite`, `schedulingTestSuite`, `workerTestSuite`, etc.
- Context helpers: `extendWithCommon`, `extendWithStateInProcess`, `extendWithNotifyInProcess`, `extendWithNotifyNoop`

### Internal (`./internal`)

Internal utilities for adapter packages only (not for application use):

- Utilities: `withRetry`, `createAsyncLock`, `wrapStateAdapterWithRetry`
- In-process adapters: `createInProcessStateAdapter`, `createInProcessNotifyAdapter`

## Documentation

For full documentation, examples, and API reference, see the [main Queuert README](https://github.com/kvet/queuert#readme).
