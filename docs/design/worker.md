# Worker Design

## Overview

This document describes the worker design in Queuert: how workers process jobs, manage concurrency, handle failures, and scale.

A **worker** acquires pending jobs from the state adapter and executes them using registered handlers. Workers can run multiple **executors** concurrently, each processing one job at a time.

## Quick Start

```typescript
import { createQueuertInProcessWorker } from "queuert";

const worker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,     // optional
  jobTypeRegistry,
  log,

  jobTypeProcessors: {
    myJob: {
      process: async ({ job, complete }) => {
        // Process the job
        return complete({ result: 'done' });
      },
    },
  },
});

const stop = await worker.start();

// Later: graceful shutdown
await stop();
```

## Concurrency Model

Workers support configurable concurrency via the `concurrency` option with three scaling strategies.

### Scaling Strategies

| Strategy | Behavior | Best For |
|----------|----------|----------|
| **fixed** | Always N executors | Predictable resource usage |
| **reactive** | Immediate scale up/down based on queue pressure | Low latency, bursty workloads |
| **adaptive** | Smooth scale up/down based on utilization | Resource efficiency |

### Configuration

```typescript
// Fixed: always 4 executors from start
concurrency: { scaling: 'fixed', executors: 4 }

// Reactive: immediate reactions to queue state
concurrency: { scaling: 'reactive', maxExecutors: 4 }

// Adaptive: smooth scaling based on utilization
concurrency: { scaling: 'adaptive', maxExecutors: 4 }
```

Default (no `concurrency` option): single executor, equivalent to `{ scaling: 'fixed', executors: 1 }`.

### Fixed Strategy

Spawns exactly N executors at worker start. No scaling.

```typescript
concurrency: { scaling: 'fixed', executors: 4 }
```

- **Behavior**: All executors start immediately and run until shutdown
- **Use case**: Known workload, predictable resource allocation
- **Trade-off**: May over-provision during quiet periods

### Reactive Strategy

Scales immediately based on queue pressure. Optimizes for latency.

```typescript
concurrency: { scaling: 'reactive', maxExecutors: 4 }
```

- **Scale up**: Executor acquires job AND more pending jobs exist → spawn new executor
- **Scale down**: Executor finds no job AND other executors are idle → terminate
- **Minimum**: Always keeps at least one executor running

```
Jobs arrive  → spawn executors immediately (up to max)
Jobs finish  → terminate idle executors immediately (keep 1)
```

- **Use case**: Bursty workloads where latency matters
- **Trade-off**: May thrash (rapid spawn/terminate) with irregular traffic

### Adaptive Strategy

Scales smoothly based on executor utilization over time. Optimizes for efficiency.

```typescript
concurrency: { scaling: 'adaptive', maxExecutors: 4 }
```

- **Scale up**: Utilization exceeds high threshold over time window → spawn new executor
- **Scale down**: Utilization drops below low threshold over time window → terminate
- **Minimum**: Always keeps at least one executor running

```
Sustained high load  → gradually add executors
Sustained low load   → gradually remove executors
```

- **Use case**: Steady workloads, resource-conscious environments
- **Trade-off**: Slower reaction to sudden bursts

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Worker Process                         │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │Executor 1│  │Executor 2│  │Executor 3│  ... up to max   │
│  └──────────┘  └──────────┘  └──────────┘                  │
│       │              │              │                       │
│       ▼              ▼              ▼                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │            Shared State Adapter                      │   │
│  │         (FOR UPDATE SKIP LOCKED)                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

Executors compete for jobs via database-level locking. Each executor runs independently, acquiring and processing jobs in its own loop.

### Horizontal Scaling

For scaling across multiple machines or processes, deploy separate workers:

```typescript
// Process A
const worker = await createQueuertInProcessWorker({
  ...config,
  workerId: 'machine-a',
  jobTypeProcessing: {
    concurrency: { scaling: 'reactive', maxExecutors: 10 },
  },
  jobTypeProcessors: { ... },
});

// Process B (separate Node.js process)
const worker = await createQueuertInProcessWorker({
  ...config,
  workerId: 'machine-b',
  jobTypeProcessing: {
    concurrency: { scaling: 'reactive', maxExecutors: 10 },
  },
  jobTypeProcessors: { ... },
});
```

Workers across processes compete for jobs via database-level locking (`FOR UPDATE SKIP LOCKED` in PostgreSQL). Each worker scales its executors independently.

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
  jobTypeProcessing: { ... },
});
```

The "InProcess" suffix indicates this worker runs in the same Node.js process as the calling code—ideal for I/O-bound workloads.

### Executor Loop

Each executor runs this loop:

1. **Reap**: Reclaim one expired lease (if any)
2. **Wait**: Listen for notification or poll timeout
3. **Acquire**: Get next pending job from state adapter
4. **Process**: Execute job handler
5. **Scale decision**: Spawn/terminate executors based on strategy
6. **Delay**: Wait `nextJobDelayMs` before next iteration
7. **Repeat**

### Shutdown

Calling `stop()` triggers graceful shutdown:

1. Signal abort controller to all executors
2. Stop spawning new executors
3. Wait for all in-flight jobs to complete (or abandon via lease expiry)
4. Emit `workerStopping` and `workerStopped` observability events

## Job Processing

### Acquisition

When an executor looks for work:

1. Query for earliest `pending` job matching registered type names
2. Filter by scheduled time (`scheduled_for <= now()`)
3. Atomically transition to `running` and increment `attempt`
4. Return job or `undefined` if none available

PostgreSQL uses `FOR UPDATE SKIP LOCKED` to allow concurrent executors without blocking.

### Lease Management

Leases provide distributed mutual exclusion with automatic recovery:

- **Ownership**: Only one executor processes a job at a time
- **Recovery**: If an executor dies, lease expires and job becomes available
- **Detection**: Executors detect when they've lost ownership

**Lease flow:**

1. **Acquire**: Job marked `running` (no lease yet)
2. **First prepare**: Sets `leasedBy: workerId` and `leasedUntil: now() + leaseMs`
3. **Staged processing**: Background loop renews lease every `renewIntervalMs`
4. **Complete**: Clears lease, marks job `completed`

**Configuration:**

```typescript
const leaseConfig = {
  leaseMs: 60_000,        // How long before lease expires
  renewIntervalMs: 30_000, // How often to renew
};
```

Rule of thumb: `renewIntervalMs` should be less than half of `leaseMs` to handle network delays.

### Completion

Job handlers complete jobs by calling `complete()`:

```typescript
process: async ({ job, complete }) => {
  const result = await doWork(job.input);
  return complete({ output: result });
}
```

### Retry and Backoff

When a job handler throws:

1. **`RescheduleJobError`**: Uses the schedule from the error (explicit reschedule)
2. **Other errors**: Calculates backoff delay based on attempt count
3. **Takeover/completion errors**: Swallowed (job already handled elsewhere)

**Backoff calculation:**

```
delay = min(initialDelayMs * multiplier^(attempt-1), maxDelayMs)
```

Example with defaults: 10s → 20s → 40s → 80s → 160s → 300s → 300s...

**Configuration:**

```typescript
const retryConfig = {
  initialDelayMs: 10_000,   // First retry delay
  maxDelayMs: 300_000,      // Maximum delay (5 minutes)
  multiplier: 2.0,          // Exponential backoff
};
```

## Reliability

### Reaper

The reaper reclaims jobs with expired leases, making them available for retry.

At the start of each executor loop iteration:

1. Find oldest `running` job where `leasedUntil < now()` and type matches registered types
2. Transition job: `running` → `pending`, clear `leasedBy` and `leasedUntil`
3. Emit `jobReaped` observability event
4. Notify via `jobScheduled` (executors wake up) and `jobOwnershipLost` (original executor aborts)

**Design decisions:**

- **Integrated with executors**: Each executor runs reaper logic. No separate process needed.
- **One job per iteration**: Reaps at most one job to avoid blocking job processing.
- **Type-scoped**: Executors only reap job types they're registered to handle.
- **Concurrent-safe**: With multiple executors, database locking prevents conflicts.

### Abort Signal

Process functions receive a typed abort signal:

```typescript
process: async ({ signal, job, complete }) => {
  if (signal.aborted) {
    console.log('Aborted:', signal.reason);
  }
}
```

Abort reasons:

- `taken_by_another_worker`: Lease renewal found another worker owns the job
- `already_completed`: Job was completed externally (workerless completion)
- `not_found`: Job was deleted during processing
- `error`: Infrastructure error during lease operations

### Ownership Loss Detection

During staged processing, executors detect ownership loss via:

1. **Lease renewal failure**: Another worker took the job
2. **Notification channel**: Reaper or workerless completion notifies `jobOwnershipLost`
3. **Guard checks**: Each database operation verifies job still belongs to this worker

When detected, the abort signal fires with the appropriate reason.

## Extensibility

### Multi-Type Workers

A single worker can handle multiple job types:

```typescript
const worker = await createQueuertInProcessWorker({
  ...adapters,
  workerId: 'multi-worker',
  jobTypeProcessors: {
    'type-a': { process: processA },
    'type-b': { process: processB },
  },
});
```

The worker polls all registered types together and processes whichever is available first.

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
jobAttemptMiddlewares: [middleware1, middleware2, middleware3]

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

OpenTelemetry tracing:

```typescript
const tracingMiddleware: JobAttemptMiddleware<...> = async ({ job }, next) => {
  return tracer.startActiveSpan(`job:${job.typeName}`, async (span) => {
    try {
      return await next();
    } finally {
      span.end();
    }
  });
};
```

See `examples/log-pino` and `examples/log-winston` for complete implementations.

### Notification Integration

Workers use a hybrid polling + notification approach:

1. **Primary**: Listen for `jobScheduled` notifications on registered types
2. **Fallback**: Poll at `pollIntervalMs` intervals

When notified, executors immediately check for available jobs. This reduces latency from seconds (polling) to milliseconds (notification).

The notification layer is optional—workers function correctly with polling alone.

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

  // Processing
  jobTypeProcessing: {
    concurrency: { scaling: 'fixed', executors: 1 },
    pollIntervalMs: 60_000,
    nextJobDelayMs: 0,
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
// Fixed pool
concurrency: { scaling: 'fixed', executors: 4 }

// Reactive scaling
concurrency: { scaling: 'reactive', maxExecutors: 10 }

// Adaptive scaling
concurrency: { scaling: 'adaptive', maxExecutors: 10 }
```

### Lease Options

```typescript
leaseConfig: {
  leaseMs: 60_000,         // Lease duration
  renewIntervalMs: 30_000, // Renewal frequency
}
```

### Retry Options

```typescript
retryConfig: {
  initialDelayMs: 10_000,  // First retry delay
  maxDelayMs: 300_000,     // Maximum delay
  multiplier: 2.0,         // Backoff multiplier
}
```

## Client vs Worker

Queuert separates job management from job processing:

| | QueuertClient | QueuertInProcessWorker |
|--|---------------|------------------------|
| **Purpose** | Job chain lifecycle | Job execution |
| **Methods** | `startJobChain()`, `getJobChain()`, `completeJobChain()` | `start()`, `stop()` |
| **Use case** | API servers, job submission | Background processors |

Both can run in the same process or separately:

```typescript
// Same process
const client = await createQueuertClient({ stateAdapter, ... });
const worker = await createQueuertInProcessWorker({ stateAdapter, ... });

// Submit job via client
await client.startJobChain({ ... });

// Worker processes it automatically
```

## Summary

The worker design emphasizes:

1. **Simplicity**: Sequential by default, concurrent when needed
2. **Choice**: Three scaling strategies (fixed, reactive, adaptive) for different workloads
3. **Reliability**: Leases ensure recovery from executor/worker failures
4. **Flexibility**: Per-type configuration, multi-type workers
5. **Observability**: All state transitions emit structured events
6. **Graceful degradation**: Works without notification layer
7. **Extensibility**: Middlewares enable cross-cutting concerns
