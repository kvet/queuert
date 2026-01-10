# Queuert

Control flow library for your persistency layer driven applications.

Run your application logic as a series of background jobs that are started alongside state change transactions in your persistency layer. Perform long-running tasks with side-effects reliably in the background and keep track of their progress in your database. Own your stack and avoid vendor lock-in by using the tools you trust.

## Sorry, what?

Imagine you have some long-running process. For example, performing image processing and asset distribution after a user uploads an image.

```ts
const queuert = createQueuert({
  stateAdapter: ...,
  jobTypeDefinitions: defineUnionJobTypes<{
    'process-image': {
      input: { imageId: string };
      output: DefineContinuationOutput<"distribute-image">;
    };
    'distribute-image': {
      input: DefineContinuationInput<{ imageId: string; minifiedImageId: string }>;
      output: { done: true };
    };
  }>(),
})

queuert.withNotify(async () => db.transaction(async (tx) => {
  const image = await tx.images.create({ ... });

  await queuert.startJobSequence({
    tx,
    typeName: "process-image",
    input: { imageId: image.id },
  });
}));
```

We scheduled the task inside a database transaction. This ensures that if the transaction rolls back, the job is not started. (Refer to transactional outbox pattern.)

Later, a background worker picks up the job and processes it:

```ts
queuert.createWorker()
  .implementJobType({
    typeName: "process-image",
    process: async ({ job, prepare, complete }) => {
      const image = await prepare({ mode: "staged" }, async ({ tx }) => {
        return tx.images.getById(job.input.imageId);
      });

      const minifiedImage = await minifyImage(image);

      return complete(async ({ tx, continueWith }) => {
        const saved = await tx.minifiedImages.create({ image: minifiedImage });

        return continueWith({
          tx,
          typeName: "distribute-image",
          input: { imageId: job.input.imageId, minifiedImageId: saved.id },
        });
      });
    },
  })
  .implementJobType({
    typeName: "distribute-image",
    process: async ({ job, prepare, complete }) => {
      const [image, minifiedImage] = await prepare({ mode: "staged" }, async ({ tx }) => {
        return Promise.all([
          tx.images.getById(job.input.imageId),
          tx.minifiedImages.getById(job.input.minifiedImageId),
        ]);
      });

      const cdnUrl = await distributeImageToCDN(minifiedImage, 'some-cdn');

      return complete(async ({ tx }) => {
        await tx.distributions.create({
          imageId: image.id,
          minifiedImageId: minifiedImage.id,
          cdnUrl,
        });

        return { done: true };
      });
    },
  })
```

## It looks familiar, right?

This library is inspired by workflow engines like [Temporal](https://temporal.io/) and queue engines like [BullMQ](https://docs.bullmq.io/).

However, instead of introducing a new persistence layer, Queuert leverages your existing database as the source of truth for both your application state and control flow. This allows you to avoid vendor lock-in and use the tools you already trust. Additionally, Queuert focuses on providing a simple and flexible API for defining and processing jobs, without the complexity of a full-fledged workflow engine and not well structured queue engine. By running jobs as database transactions, Queuert ensures data consistency and reliability, making it a great fit for applications that require robust background processing capabilities.

## Installation

```bash
# Core package (required)
npm install queuert

# State adapters (pick one)
npm install @queuert/postgres  # PostgreSQL (also includes notify adapter)
npm install @queuert/sqlite    # SQLite
npm install @queuert/mongodb   # MongoDB (requires 4.0+ for transactions)

# Notify adapters (optional, for reduced latency)
npm install @queuert/redis     # Redis pub/sub (recommended for production)
npm install @queuert/nats      # NATS pub/sub (with optional JetStream KV for hints)
# Or use PostgreSQL LISTEN/NOTIFY via @queuert/postgres (no extra infra)
```

## Core Concepts

### Job

An individual unit of work. Jobs have a lifecycle: `pending` → `running` → `completed`. Each job belongs to a Job Type and contains typed input/output. Jobs can also be `blocked` if they depend on other jobs to complete first.

### Job Sequence

A chain of linked jobs where each job can `continueWith` to the next - just like a Promise chain. In fact, a sequence IS its first job, the same way a Promise chain IS the first promise. When you call `startJobSequence`, the returned `sequence.id` is the first job's ID. Continuation jobs share this `sequenceId` but have their own unique `id`. The sequence completes when its final job completes without continuing.

### Job Type

Defines a named job type with its input/output types and process function. Job types are registered with workers via `implementJobType`. The process function receives the job and context for completing or continuing the sequence.

### State Adapter

Abstracts database operations for job persistence. Queuert provides adapters for PostgreSQL, SQLite, and MongoDB. The adapter handles job creation, status transitions, leasing, and queries.

**Available adapters:**

- `@queuert/postgres` - PostgreSQL state adapter
- `@queuert/sqlite` - SQLite state adapter
- `@queuert/mongodb` - MongoDB state adapter (requires MongoDB 4.0+ for multi-document transactions)
- `createInProcessStateAdapter()` - In-memory adapter (for testing)

### State Provider

Bridges your database client (Kysely, Drizzle, Prisma, raw pg, etc.) with the state adapter. You implement a simple interface that provides transaction handling and SQL execution.

### Notify Adapter

Handles pub/sub notifications for efficient job scheduling. When a job is created, workers are notified immediately instead of polling. This reduces latency from seconds to milliseconds.

**Available adapters:**

- `@queuert/redis` - Redis notify adapter (recommended for production, includes hint-based optimization)
- `@queuert/nats` - NATS notify adapter (with optional JetStream KV for hint-based optimization)
- `@queuert/postgres` - PostgreSQL notify adapter (uses LISTEN/NOTIFY, no additional infrastructure)
- `createInProcessNotifyAdapter()` - In-memory adapter (for single-process apps)
- None (default) - polling only, no real-time notifications

### Notify Provider

Bridges your pub/sub client (Redis, PostgreSQL, etc.) with the notify adapter. Similar to state providers, you implement an interface for publishing messages and subscribing to channels.

### Worker

Processes jobs by polling for available work. Workers automatically renew leases during long-running operations and handle retries with configurable backoff.

## Complete Type Safety

Queuert provides end-to-end type safety with full type inference. Define your job types once, and TypeScript ensures correctness throughout your entire codebase:

- **Job inputs and outputs** are inferred and validated at compile time
- **Continuations** are type-checked — `continueWith` only accepts valid target job types with matching inputs
- **Blockers** are fully typed — access `job.blockers` with correct output types for each blocker
- **Internal job types** marked with `DefineContinuationInput` cannot be started directly via `startJobSequence`

No runtime type errors. No mismatched job names. Your workflow logic is verified before your code ever runs.

## Job Processing Modes

Jobs support two processing modes via the `prepare` function:

### Atomic Mode

Everything runs in a single transaction. Use for quick operations.

```ts
queuert.createWorker()
  .implementJobType({
    typeName: "process-item",
    process: async ({ job, prepare, complete }) => {
      const data = await prepare({ mode: "atomic" }, async ({ db }) => {
        return db.query("SELECT * FROM items WHERE id = ?", [job.input.id]);
      });
      return complete(async ({ db }) => {
        await db.query("UPDATE items SET processed = true WHERE id = ?", [job.input.id]);
        return { processed: true };
      });
    },
  });
```

### Staged Mode

Prepare and complete run in separate transactions with a processing phase in between. The worker automatically renews the job lease during the processing phase. Use for long-running operations.

```ts
queuert.createWorker()
  .implementJobType({
    typeName: "process-item",
    process: async ({ job, prepare, complete }) => {
      // Phase 1: Prepare (transaction)
      const data = await prepare({ mode: "staged" }, async ({ db }) => {
        return db.query("SELECT * FROM items WHERE id = ?", [job.input.id]);
      });

      // Phase 2: Processing (no transaction, lease auto-renewed)
      // Implement idempotently - may retry if worker crashes
      const result = await processData(data);

      // Phase 3: Complete (transaction)
      return complete(async ({ db }) => {
        await db.query("UPDATE items SET result = ? WHERE id = ?", [result, job.input.id]);
        return { result };
      });
    },
  });
```

### Auto-Setup

If you don't call `prepare`, auto-setup runs based on when you call `complete`:

- Call `complete` synchronously → atomic mode
- Call `complete` after async work → staged mode (lease renewal active)

## Job Sequence Patterns

Sequences support various execution patterns via `continueWith`:

### Linear

Jobs execute one after another: `A → B`

```ts
type Definitions = DefineJobTypeDefinitions<{
  step1: { input: { id: string }; output: DefineContinuationOutput<"step2"> };
  step2: { input: DefineContinuationInput<{ id: string }>; output: { done: true } };
}>;

// Start the sequence
await queuert.startJobSequence({
  typeName: "step1",
  input: { id: "123" },
});

// Process in worker
queuert.createWorker()
  .implementJobType({
    typeName: "step1",
    process: async ({ job, complete }) => {
      return complete(async ({ continueWith }) => {
        return continueWith({ typeName: "step2", input: { id: job.input.id } });
      });
    },
  })
  .implementJobType({
    typeName: "step2",
    process: async ({ job, complete }) => {
      return complete(() => ({ done: true }));
    },
  });
```

### Branched

Jobs can conditionally continue to different types: `A → B1 | B2`

```ts
type Definitions = DefineJobTypeDefinitions<{
  main: {
    input: { value: number };
    output: DefineContinuationOutput<"branch1"> | DefineContinuationOutput<"branch2">;
  };
  branch1: { input: DefineContinuationInput<{ value: number }>; output: { result1: number } };
  branch2: { input: DefineContinuationInput<{ value: number }>; output: { result2: number } };
}>;

// Start the sequence
await queuert.startJobSequence({
  typeName: "main",
  input: { value: 42 },
});

// Process in worker
queuert.createWorker()
  .implementJobType({
    typeName: "main",
    process: async ({ job, complete }) => {
      return complete(async ({ continueWith }) => {
        return continueWith({
          typeName: job.input.value % 2 === 0 ? "branch1" : "branch2",
          input: { value: job.input.value },
        });
      });
    },
  });
```

### Loops

Jobs can continue to the same type: `A → A → A → done`

```ts
type Definitions = DefineJobTypeDefinitions<{
  loop: {
    input: { counter: number };
    output: DefineContinuationOutput<"loop"> | { done: true };
  };
}>;

// Start the sequence
await queuert.startJobSequence({
  typeName: "loop",
  input: { counter: 0 },
});

// Process in worker
queuert.createWorker()
  .implementJobType({
    typeName: "loop",
    process: async ({ job, complete }) => {
      return complete(async ({ continueWith }) => {
        return job.input.counter < 3
          ? continueWith({ typeName: "loop", input: { counter: job.input.counter + 1 } })
          : { done: true };
      });
    },
  });
```

### Go-to

Jobs can jump back to earlier types: `A → B → A → B → done`

```ts
type Definitions = DefineJobTypeDefinitions<{
  start: { input: { value: number }; output: DefineContinuationOutput<"end"> };
  end: {
    input: DefineContinuationInput<{ result: number }>;
    output: DefineContinuationOutput<"start"> | { finalResult: number };
  };
}>;

// Start the sequence
await queuert.startJobSequence({
  typeName: "start",
  input: { value: 10 },
});

// Process in worker
queuert.createWorker()
  .implementJobType({
    typeName: "start",
    process: async ({ job, complete }) => {
      return complete(async ({ continueWith }) => {
        return continueWith({ typeName: "end", input: { result: job.input.value * 2 } });
      });
    },
  })
  .implementJobType({
    typeName: "end",
    process: async ({ job, complete }) => {
      return complete(async ({ continueWith }) => {
        return job.input.result < 100
          ? continueWith({ typeName: "start", input: { value: job.input.result } })
          : { finalResult: job.input.result };
      });
    },
  });
```

## Job Blockers

Jobs can depend on other job sequences to complete before they start. A job with incomplete blockers starts as `blocked` and transitions to `pending` when all blockers complete.

```ts
type Definitions = DefineJobTypeDefinitions<{
  'fetch-data': {
    input: { url: string };
    output: { data: string };
  };
  'process-all': {
    input: { ids: string[] };
    output: { results: string[] };
    blockers: DefineBlocker<'fetch-data'>[];  // Wait for multiple fetches
  };
}>;

// Start with blockers
await queuert.startJobSequence({
  typeName: 'process-all',
  input: { ids: ['a', 'b', 'c'] },
  startBlockers: async () => Promise.all([
    queuert.startJobSequence({ typeName: 'fetch-data', input: { url: '/a' } }),
    queuert.startJobSequence({ typeName: 'fetch-data', input: { url: '/b' } }),
  ]),
});

// Access completed blockers in worker
queuert.createWorker()
  .implementJobType({
    typeName: 'process-all',
    process: async ({ job, complete }) => {
      const results = job.blockers.map(b => b.output.data);
      return complete(() => ({ results }));
    },
  });
```

## Error Handling

Queuert provides only job completion — there is no built-in "failure" state. This is intentional: you control how errors are represented in your job outputs.

Handle failures by returning error information in your output types:

```ts
type Definitions = DefineJobTypeDefinitions<{
  'process-payment': {
    input: { orderId: string };
    output: { success: true; transactionId: string } | { success: false; error: string };
  };
}>;
```

For workflows that need rollback, use the compensation pattern — a "failed" job can continue to a compensation job that undoes previous steps:

```ts
type Definitions = DefineJobTypeDefinitions<{
  'charge-card': {
    input: { orderId: string };
    output: DefineContinuationOutput<"ship-order"> | DefineContinuationOutput<"refund-charge">;
  };
  'ship-order': {
    input: DefineContinuationInput<{ orderId: string; chargeId: string }>;
    output: { shipped: true } | DefineContinuationOutput<"refund-charge">;
  };
  'refund-charge': {
    input: DefineContinuationInput<{ chargeId: string }>;
    output: { refunded: true };
  };
}>;
```

## Deferred Start

Jobs can be scheduled to start at a future time using the `schedule` option. The job is created transactionally but won't be processed until the specified time.

```ts
// Schedule a job to run in 5 minutes
await queuert.startJobSequence({
  typeName: 'send-reminder',
  input: { userId: '123' },
  schedule: { afterMs: 5 * 60 * 1000 }, // 5 minutes from now
});

// Or schedule at a specific time
await queuert.startJobSequence({
  typeName: 'send-reminder',
  input: { userId: '123' },
  schedule: { at: new Date('2025-01-15T09:00:00Z') },
});
```

The same `schedule` option works with `continueWith` for deferred continuations:

```ts
await complete(job, async ({ continueWith }) =>
  continueWith({
    typeName: 'follow-up',
    input: { userId: job.input.userId },
    schedule: { afterMs: 24 * 60 * 60 * 1000 }, // 24 hours later
  })
);
```

## Workerless Completion

Jobs can be completed without a worker using `completeJobSequence`. This enables approval workflows, webhook-triggered completions, and patterns where jobs wait for external events. Deferred start pairs well with this — schedule a job to auto-reject after a timeout, but allow early completion based on user action.

```ts
type Definitions = DefineJobTypeDefinitions<{
  'await-approval': {
    input: { requestId: string };
    output: { rejected: true } | DefineContinuationOutput<'process-request'>;
  };
  'process-request': {
    input: DefineContinuationInput<{ requestId: string }>;
    output: { processed: true };
  };
}>;

// Start a job that auto-rejects in 2 hours if not handled
const sequence = await queuert.startJobSequence({
  typeName: 'await-approval',
  input: { requestId: '123' },
  schedule: { afterMs: 2 * 60 * 60 * 1000 }, // 2 hours
});

// The worker handles the timeout case (auto-reject, sequence ends)
worker.implementJobType({
  typeName: 'await-approval',
  process: async ({ complete }) => complete(() => ({ rejected: true })),
});

// The worker processes approved requests
worker.implementJobType({
  typeName: 'process-request',
  process: async ({ job, complete }) => {
    await doSomethingWith(job.input.requestId);
    return complete(() => ({ processed: true }));
  },
});

// The job can be completed early without a worker (e.g., via API call)
await queuert.completeJobSequence({
  id: sequence.id,
  typeName: 'await-approval',
  complete: async ({ job, complete }) => {
    if (job.typeName !== 'await-approval') {
      return; // Already past approval stage
    }
    // If approved, continue to process-request; otherwise just reject
    if (userApproved) {
      await complete(job, ({ continueWith }) =>
        continueWith({ typeName: 'process-request', input: { requestId: job.input.requestId } })
      );
    } else {
      await complete(job, () => ({ rejected: true }));
    }
  },
});
```

This pattern lets you interweave external actions with your job sequences — waiting for user input, third-party callbacks, or manual approval steps.

## Timeouts

For cooperative timeouts, combine `AbortSignal.timeout()` with the provided `signal`:

```ts
worker.implementJobType({
  typeName: 'fetch-data',
  process: async ({ signal, job, complete }) => {
    const timeout = AbortSignal.timeout(30_000); // 30 seconds
    const combined = AbortSignal.any([signal, timeout]);

    // Use combined signal for cancellable operations
    const response = await fetch(job.input.url, { signal: combined });
    const data = await response.json();

    return complete(() => ({ data }));
  },
});
```

For hard timeouts, configure `leaseMs` — if a job doesn't complete or renew its lease in time, the reaper reclaims it for retry:

```ts
worker.implementJobType({
  typeName: 'long-running-job',
  leaseConfig: { leaseMs: 300_000, renewIntervalMs: 60_000 }, // 5 min lease
  process: async ({ job, complete }) => { ... },
});
```

## Configuration

Workers support various configuration options when started:

```ts
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
});
```

Per-job-type configuration can also be set via `implementJobType`:

```ts
worker.implementJobType({
  typeName: 'long-running-job',
  retryConfig: { initialDelayMs: 30_000, multiplier: 2.0, maxDelayMs: 600_000 },
  leaseConfig: { leaseMs: 300_000, renewIntervalMs: 60_000 },
  process: async ({ job, complete }) => { ... },
});
```

## Testing & Resilience

Queuert includes comprehensive test suites that verify job execution guarantees under various failure conditions. The resilience tests simulate transient database errors to ensure jobs complete successfully even when infrastructure is unreliable.

Test suites available in [`packages/core/src/suites/`](./packages/core/src/suites/):

- [`process.test-suite.ts`](./packages/core/src/suites/process.test-suite.ts) — Atomic/staged modes, prepare/complete patterns
- [`sequences.test-suite.ts`](./packages/core/src/suites/sequences.test-suite.ts) — Linear, branched, loop, go-to patterns
- [`blocker-sequences.test-suite.ts`](./packages/core/src/suites/blocker-sequences.test-suite.ts) — Job dependencies and blocking
- [`workerless-completion.test-suite.ts`](./packages/core/src/suites/workerless-completion.test-suite.ts) — External job completion
- [`scheduling.test-suite.ts`](./packages/core/src/suites/scheduling.test-suite.ts) — Scheduled job execution and rescheduling
- [`deduplication.test-suite.ts`](./packages/core/src/suites/deduplication.test-suite.ts) — Duplicate job prevention
- [`state-resilience.test-suite.ts`](./packages/core/src/suites/state-resilience.test-suite.ts) — Transient error handling
- [`reaper.test-suite.ts`](./packages/core/src/suites/reaper.test-suite.ts) — Expired lease reclamation
- [`worker.test-suite.ts`](./packages/core/src/suites/worker.test-suite.ts) — Worker lifecycle and polling

These suites run against all supported adapters (PostgreSQL, SQLite, MongoDB, in-memory) to ensure consistent behavior across databases.

## Full Example

For a complete working example with PostgreSQL (Kysely) and Redis, see the [examples/postgres-kysely-redis](./examples/postgres-kysely-redis) directory.

## License

MIT
