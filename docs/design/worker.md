# Worker Design

## Overview

This document describes the worker design in Queuert: how workers coordinate job processing, manage concurrency, and handle failures.

A **worker** runs a main loop that coordinates job processing across multiple **slots**. Each slot processes one job at a time; the worker manages concurrency and scaling.

## Quick Start

```typescript
import { createQueuertInProcessWorker } from "queuert";

const worker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter, // optional
  jobTypeRegistry,
  log,

  jobTypeProcessors: {
    myJob: {
      process: async ({ job, complete }) => {
        // Process the job
        return complete({ result: "done" });
      },
    },
  },
});

const stop = await worker.start();

// Later: graceful shutdown
await stop();
```

## Concurrency Model

Workers process jobs in parallel using slots. Configure concurrency via the `concurrency` option:

```typescript
concurrency: {
  maxSlots: 10,
}
```

Default: single slot (`maxSlots: 1`).

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Worker                              │
│                                                             │
│  Main Loop                                                  │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 1. Reap expired lease                                 │ │
│  │ 2. Fill available slots                               │ │
│  │ 3. Wait for notification, timeout, or slot completion │ │
│  └───────────────────────────────────────────────────────┘ │
│                           │                                 │
│           ┌───────────────┼───────────────┐                │
│           ▼               ▼               ▼                │
│     ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│     │  Slot 0  │    │  Slot 1  │    │  Slot 2  │  ...     │
│     │ acquire  │    │ acquire  │    │ acquire  │          │
│     │ process  │    │ process  │    │ process  │          │
│     └──────────┘    └──────────┘    └──────────┘          │
│           │               │               │                 │
│           └───────────────┴───────────────┘                │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │            Shared State Adapter                      │   │
│  │         (FOR UPDATE SKIP LOCKED)                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**How it works:**

1. Main loop spawns slots up to `maxSlots`
2. Each slot acquires a job and processes it independently
3. When a slot completes, main loop spawns a replacement
4. Slots compete for jobs via database-level locking

### Slot Lifecycle

Each slot is self-contained:

```typescript
async function runSlot() {
  const job = await acquire(); // Get next pending job
  if (!job) return; // No work, slot exits

  await processJob(job); // Execute handler
  // Slot completes, main loop spawns replacement
}
```

Slots notify the main loop on completion, allowing immediate replacement if work is available.

### Horizontal Scaling

For scaling across multiple machines or processes, deploy separate workers:

```typescript
// Process A
const worker = await createQueuertInProcessWorker({
  ...config,
  workerId: 'machine-a',
  concurrency: { maxSlots: 10 },
  jobTypeProcessors: { ... },
});

// Process B (separate Node.js process)
const worker = await createQueuertInProcessWorker({
  ...config,
  workerId: 'machine-b',
  concurrency: { maxSlots: 10 },
  jobTypeProcessors: { ... },
});
```

Workers compete for jobs via database-level locking (`FOR UPDATE SKIP LOCKED` in PostgreSQL).

## Worker Lifecycle

### Creation

Workers are created with `createQueuertInProcessWorker()`:

```typescript
const worker = await createQueuertInProcessWorker({
  // Required
  stateAdapter,
  jobTypeRegistry,
  log,
  jobTypeProcessors: { ... },

  // Optional
  notifyAdapter,
  observabilityAdapter,
  workerId: 'worker-1',  // default: random UUID
  concurrency: { ... },
  jobTypeProcessing: { ... },
});
```

The "InProcess" suffix indicates this worker runs in the same Node.js process as the calling code—ideal for I/O-bound workloads.

### Main Loop

The worker runs a single coordinating loop:

1. **Reap**: Reclaim one expired lease (if any)
2. **Fill**: Spawn slots up to `maxSlots`
3. **Wait**: Listen for notification, poll timeout, or slot completion
4. **Repeat**

```typescript
while (!stopped) {
  await reapExpiredLease();

  while (activeSlots < maxSlots) {
    spawnSlot();
  }

  await Promise.race([waitForNotification(), slotCompleted.wait(), sleep(pollIntervalMs)]);
}
```

### Shutdown

Calling `stop()` triggers graceful shutdown:

1. Signal abort controller
2. Stop spawning new slots
3. Wait for all in-flight jobs to complete (or abandon via lease expiry)
4. Emit `workerStopping` and `workerStopped` observability events

## Worker Identity

Each worker has a unique identity stored in `leasedBy` (e.g., `'worker-1'`).

**Abort signal routing:**

The worker tracks active jobs internally:

```typescript
const activeJobs = new Map<string, AbortController>();

// On ownership lost notification:
function onOwnershipLost(jobId: string) {
  activeJobs.get(jobId)?.abort("taken_by_another_worker");
}
```

No per-slot identity is needed—the worker routes abort signals by job ID.

## Reaper

The reaper reclaims jobs with expired leases, making them available for retry.

At the start of each main loop iteration:

1. Find oldest `running` job where `leasedUntil < now()` and type matches registered types
2. Transition job: `running` → `pending`, clear `leasedBy` and `leasedUntil`
3. Emit `jobReaped` observability event
4. Notify via `jobScheduled` (workers wake up) and `jobOwnershipLost` (original worker aborts)

**Design decisions:**

- **Integrated with main loop**: Runs once per iteration, no separate process needed.
- **One job per iteration**: Reaps at most one job to avoid blocking slot spawning.
- **Type-scoped**: Only reaps job types the worker is registered to handle.
- **Concurrent-safe**: Database locking prevents conflicts between workers.
- **Self-aware**: When running with multiple slots, the reaper excludes jobs currently being processed by the same worker (via `ignoredJobIds`). This prevents a race condition where a worker could reap its own in-progress job if the lease expires before renewal.

## Retry and Backoff

When a job handler throws, the worker reschedules it with exponential backoff:

```
delay = min(initialDelayMs * multiplier^(attempt-1), maxDelayMs)
```

Example with defaults: 10s → 20s → 40s → 80s → 160s → 300s → 300s...

See [Job Processing](job-processing.md) for details on error handling and abort signals.

## Extensibility

### Multi-Type Workers

A single worker can handle multiple job types:

```typescript
const worker = await createQueuertInProcessWorker({
  ...adapters,
  workerId: "multi-worker",
  jobTypeProcessors: {
    "type-a": { process: processA },
    "type-b": { process: processB },
  },
});
```

Slots poll all registered types together and process whichever is available first.

Per-type configuration overrides worker defaults:

```typescript
jobTypeProcessors: {
  'long-running': {
    leaseConfig: { leaseMs: 300_000, renewIntervalMs: 60_000 },
    retryConfig: { initialDelayMs: 30_000, maxDelayMs: 600_000 },
    process: ...
  },
}
```

### Job Attempt Middlewares

Workers support middlewares that wrap each job attempt:

```typescript
jobTypeProcessing: {
  jobAttemptMiddlewares: [
    async ({ job, workerId }, next) => {
      console.log('Before job processing');
      const result = await next();
      console.log('After job processing');
      return result;
    },
  ],
}
```

**Middleware signature:**

```typescript
type JobAttemptMiddleware<TStateAdapter, TJobTypeDefinitions> = <T>(
  context: {
    job: RunningJob<...>;
    workerId: string;
  },
  next: () => Promise<T>,
) => Promise<T>;
```

**Composition order:**

```typescript
jobAttemptMiddlewares: [middleware1, middleware2, middleware3];

// Execution:
// middleware1 before → middleware2 before → middleware3 before
// → job processing →
// middleware3 after → middleware2 after → middleware1 after
```

**Use cases:**

Contextual logging with AsyncLocalStorage:

```typescript
const jobContextStore = new AsyncLocalStorage<JobContext>();

const contextMiddleware: JobAttemptMiddleware<...> = async ({ job, workerId }, next) => {
  return jobContextStore.run(
    { jobId: job.id, typeName: job.typeName, workerId },
    next,
  );
};
```

See `examples/log-pino` and `examples/log-winston` for complete implementations.

## Configuration Reference

### Worker Options

```typescript
const worker = await createQueuertInProcessWorker({
  // Adapters
  stateAdapter,              // Required: job persistence
  notifyAdapter,             // Optional: push notifications
  observabilityAdapter,      // Optional: metrics/tracing
  jobTypeRegistry,           // Required: type definitions
  log,                       // Required: logger

  // Identity
  workerId: 'worker-1',      // Default: random UUID

  // Concurrency (optional)
  concurrency: { maxSlots: 1 },  // default

  // Processing
  jobTypeProcessing: {
    pollIntervalMs: 60_000,
    defaultRetryConfig: { ... },
    defaultLeaseConfig: { ... },
    jobAttemptMiddlewares: [...],
  },

  // Handlers
  jobTypeProcessors: {
    jobTypeName: {
      process: async ({ signal, job, prepare, complete }) => { ... },
      leaseConfig: { ... },   // Per-type override
      retryConfig: { ... },   // Per-type override
    },
  },
});
```

### Concurrency Options

```typescript
concurrency: {
  maxSlots: 10,
}
```

## Summary

The worker design emphasizes:

1. **Simplicity**: Single main loop coordinating parallel slots
2. **Efficiency**: Slots are self-contained, main loop just manages concurrency
3. **Reliability**: Integrated reaper ensures recovery from failures
4. **Flexibility**: Per-type configuration, multi-type workers
5. **Extensibility**: Middlewares enable cross-cutting concerns

See also:

- [Job Processing](job-processing.md) - prepare/complete pattern, abort signals, timeouts
- [Adapters](adapters.md) - notification optimization, state provider design
