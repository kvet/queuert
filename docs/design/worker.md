# Worker Design

## Overview

This document describes the worker and reaper design in Queuert, including job acquisition, lease management, retry logic, and graceful shutdown.

## Client-Worker Separation

### Overview

Queuert provides two independent constructions for job queue management:

- `createQueuertClient()` - Job chain management (creating, retrieving, completing chains)
- `createQueuertInProcessWorker()` - Job processing (executing job handlers)

These can be used together in the same process or deployed separately for different scaling patterns.

### QueuertClient

The client handles job chain lifecycle operations without processing jobs:

```typescript
import { createQueuertClient } from "queuert";

const client = await createQueuertClient({
  stateAdapter,
  notifyAdapter, // optional
  observabilityAdapter, // optional
  jobTypeRegistry,
  log,
});

// Available methods:
// - startJobChain() - Create job chain
// - getJobChain() - Retrieve job chain
// - deleteJobChains() - Delete job chains
// - completeJobChain() - Complete job chain externally
// - waitForJobChainCompletion() - Poll for completion
// - withNotify() - Batch notifications
```

### QueuertInProcessWorker

The worker is configured declaratively and started as a simple lifecycle method:

```typescript
import { createQueuertInProcessWorker } from "queuert";

const worker = await createQueuertInProcessWorker({
  // Adapters (same as client)
  stateAdapter,
  notifyAdapter,     // optional
  observabilityAdapter, // optional
  jobTypeRegistry,
  log,

  // Worker identity
  workerId: 'worker-1',  // optional, defaults to random UUID

  // Processing configuration (optional)
  jobTypeProcessing: {
    pollIntervalMs: 60_000,
    nextJobDelayMs: 0,
    defaultRetryConfig: { ... },
    defaultLeaseConfig: { ... },
    jobAttemptMiddlewares: [...],
  },

  // Job handlers (required)
  jobTypeProcessors: {
    myJob: {
      process: async ({ job, complete }) => { ... },
      leaseConfig: { ... },  // optional per-type override
      retryConfig: { ... },  // optional per-type override
    },
  },
});

const stop = await worker.start();
```

### Why "InProcess"?

The "InProcess" suffix indicates that this worker runs in the same Node.js process as the calling code. This design is:

- **Ideal for I/O-bound workloads**: Network calls, database queries, and external API interactions benefit from Node.js's event loop without blocking
- **Simple to deploy**: No inter-process communication overhead
- **Easy to debug**: Stack traces and logging remain in a single process

Future worker types may include subprocess workers for CPU-bound tasks that would otherwise block the event loop.

### Shared Adapters

Both client and worker accept the same adapter parameters. Create adapters once and pass to both:

```typescript
const client = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry,
});

const worker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry,
  jobTypeProcessors: { ... },
});
```

This ensures consistent configuration and allows client and worker to share database connections and notification channels efficiently.

## Worker Lifecycle

### Creation and Configuration

Workers are configured declaratively at creation time:

```typescript
const worker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry,
  workerId: 'worker-1',           // default: random UUID
  jobTypeProcessing: {
    pollIntervalMs: 60_000,       // default: 60s
    nextJobDelayMs: 0,            // delay between jobs
    defaultRetryConfig: { ... },
    defaultLeaseConfig: { ... },
  },
  jobTypeProcessors: {
    step1: { process: ... },
    step2: { process: ... },
  },
});

const stop = await worker.start();
```

### Worker Loop

Each worker runs a sequential loop:

1. While jobs available: process one job, then delay `nextJobDelayMs`
2. Run reaper (reclaim expired leases for registered job types)
3. Wait for next job (hybrid polling + notification)
4. Return to step 1

### Shutdown

Calling `stop()` triggers graceful shutdown:

1. Signal abort controller
2. Wait for current job to complete (or abandon via lease expiry)
3. Emit `workerStopping` and `workerStopped` observability events

## Concurrency Model

**Single job per worker**: Each worker processes one job at a time. This is intentional:

1. **Simplicity**: No complex coordination or resource management
2. **Predictability**: Job processing is sequential and debuggable
3. **Safety**: No race conditions within a worker

For parallelism, run multiple workers:

```typescript
const worker1 = await createQueuertInProcessWorker({
  ...sharedConfig,
  workerId: 'w1',
  jobTypeProcessors: { ... },
});
const worker2 = await createQueuertInProcessWorker({
  ...sharedConfig,
  workerId: 'w2',
  jobTypeProcessors: { ... },
});

await Promise.all([worker1.start(), worker2.start()]);
```

Workers compete for jobs via database-level locking (`FOR UPDATE SKIP LOCKED` in PostgreSQL).

## Job Acquisition

When a worker looks for work:

1. Query for earliest `pending` job matching registered type names
2. Filter by scheduled time (`scheduled_for <= now()`)
3. Atomically transition to `running` and increment `attempt`
4. Return job or `undefined` if none available

PostgreSQL uses `FOR UPDATE SKIP LOCKED` to allow concurrent workers without blocking.

## Lease Management

### Why Leases?

Leases provide distributed mutual exclusion with automatic recovery:

- **Ownership**: Only one worker processes a job at a time
- **Recovery**: If a worker dies, lease expires and job becomes available
- **Detection**: Workers detect when they've lost ownership

### Lease Flow

1. **Acquire job**: Job marked `running` (no lease yet)
2. **First prepare**: Sets `leasedBy: workerId` and `leasedUntil: now() + leaseMs`
3. **Staged processing**: Background loop renews lease every `renewIntervalMs`
4. **Complete**: Clears lease, marks job `completed`

### Configuration

```typescript
const defaultLeaseConfig = {
  leaseMs: 60_000, // How long before lease expires
  renewIntervalMs: 30_000, // How often to renew
};
```

Rule of thumb: `renewIntervalMs` should be less than half of `leaseMs` to handle network delays.

### Ownership Loss Detection

During staged processing, workers detect ownership loss via:

1. **Lease renewal failure**: Another worker took the job
2. **Notification channel**: Reaper or workerless completion notifies `jobOwnershipLost`
3. **Guard checks**: Each database operation verifies job still belongs to this worker

When detected, the abort signal fires with a typed reason.

## Abort Signal

Process functions receive a typed abort signal:

```typescript
process: async ({ signal, job, complete }) => {
  // signal: TypedAbortSignal<JobAbortReason>

  if (signal.aborted) {
    console.log("Aborted:", signal.reason);
    // "taken_by_another_worker" | "error" | "not_found" | "already_completed"
  }
};
```

Abort triggers:

- `taken_by_another_worker`: Lease renewal found another worker owns the job
- `already_completed`: Job was completed externally (workerless completion)
- `not_found`: Job was deleted during processing
- `error`: Infrastructure error during lease operations

## Retry and Backoff

### Configuration

```typescript
const retryConfig = {
  initialDelayMs: 10_000, // First retry delay
  maxDelayMs: 300_000, // Maximum delay (5 minutes)
  multiplier: 2.0, // Exponential backoff
};
```

### Backoff Calculation

```
delay = min(initialDelayMs * multiplier^(attempt-1), maxDelayMs)
```

Example with defaults: 10s → 20s → 40s → 80s → 160s → 300s → 300s...

### Error Handling

When a job handler throws:

1. **`RescheduleJobError`**: Uses the schedule from the error (explicit reschedule)
2. **Other errors**: Calculates backoff delay based on attempt count
3. **Takeover/completion errors**: Swallowed (job already handled elsewhere)

Job transitions to `pending` with `scheduled_for` set to the delay time.

## Reaper

The reaper reclaims jobs with expired leases, making them available for retry.

### How It Works

At the start of each worker loop iteration:

1. Find oldest `running` job where `leasedUntil < now()` and type matches registered types
2. Transition job: `running` → `pending`, clear `leasedBy` and `leasedUntil`
3. Emit `jobReaped` observability event
4. Notify via `jobScheduled` (workers wake up) and `jobOwnershipLost` (original worker aborts)

### Design Decisions

**Integrated with workers**: Each worker runs reaper logic for its registered types. No separate reaper process needed.

**One job per iteration**: Reaps at most one job per loop to avoid long reaper runs blocking job processing.

**Type-scoped**: Workers only reap job types they're registered to handle, enabling specialized workers.

## Multi-Type Workers

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

await worker.start();
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

## Notification Integration

Workers use a hybrid polling + notification approach:

1. **Primary**: Listen for `jobScheduled` notifications on registered types
2. **Fallback**: Poll at `pollIntervalMs` intervals

When notified, workers immediately check for available jobs. This reduces latency from seconds (polling) to milliseconds (notification).

The notification layer is optional—workers function correctly with polling alone.

## Job Attempt Middlewares

Workers support middlewares that wrap each job attempt, enabling cross-cutting concerns like contextual logging, tracing, or metrics.

### Configuration

```typescript
const worker = await createQueuertInProcessWorker({
  ...adapters,
  workerId: 'worker-1',
  jobTypeProcessing: {
    jobAttemptMiddlewares: [
      async ({ job, workerId }, next) => {
        console.log('Before job processing');
        const result = await next();
        console.log('After job processing');
        return result;
      },
    ],
  },
  jobTypeProcessors: { ... },
});

await worker.start();
```

### Middleware Signature

```typescript
type JobAttemptMiddleware<TStateAdapter, TJobTypeDefinitions> = <T>(
  context: {
    job: RunningJob<...>;  // The job being processed
    workerId: string;      // The worker processing the job
  },
  next: () => Promise<T>,  // Call to continue to next middleware or job processing
) => Promise<T>;
```

### Middleware Composition

Middlewares execute in order, wrapping the job processing:

```typescript
jobAttemptMiddlewares: [middleware1, middleware2, middleware3];

// Execution order:
// middleware1 before → middleware2 before → middleware3 before
// → job processing →
// middleware3 after → middleware2 after → middleware1 after
```

### Use Cases

**Contextual Logging with AsyncLocalStorage:**

```typescript
const jobContextStore = new AsyncLocalStorage<JobContext>();

const contextMiddleware: JobAttemptMiddleware<...> = async ({ job, workerId }, next) => {
  return jobContextStore.run(
    { jobId: job.id, typeName: job.typeName, workerId },
    next,
  );
};

// Now any logger can access job context via jobContextStore.getStore()
```

**OpenTelemetry Tracing:**

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

See the `examples/log-pino` and `examples/log-winston` examples for complete contextual logging implementations.

## Summary

The worker design emphasizes:

1. **Simplicity**: One job per worker, sequential processing
2. **Reliability**: Leases ensure recovery from worker failures
3. **Flexibility**: Per-type configuration, multi-type workers
4. **Observability**: All state transitions emit structured events
5. **Graceful degradation**: Works without notification layer
6. **Extensibility**: Middlewares enable cross-cutting concerns
