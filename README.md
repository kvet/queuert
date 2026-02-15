# Queuert

[![npm version](https://img.shields.io/npm/v/queuert.svg)](https://www.npmjs.com/package/queuert)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)

Control flow library for your persistency layer driven applications.

Run your application logic as a series of background jobs that are started alongside state change transactions in your persistency layer. Perform long-running tasks with side-effects reliably in the background and keep track of their progress in your database. Own your stack and avoid vendor lock-in by using the tools you trust.

## Table of Contents

- [Sorry, what?](#sorry-what)
- [It looks familiar, right?](#it-looks-familiar-right)
- [Why Queuert?](#why-queuert)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Horizontal Scaling](#horizontal-scaling)
- [Job Processing Modes](#job-processing-modes)
- [Job Chain Patterns](#job-chain-patterns)
- [Job Blockers](#job-blockers)
- [Error Handling](#error-handling)
- [Deferred Start](#deferred-start)
- [Deduplication](#deduplication)
- [Workerless Completion](#workerless-completion)
- [Complete Type Safety](#complete-type-safety)
- [Runtime Validation](#runtime-validation)
- [Timeouts](#timeouts)
- [Observability](#observability)
- [Testing & Resilience](#testing--resilience)
- [Benchmarks](#benchmarks)
- [License](#license)

## Sorry, what?

Imagine a user signs up and you want to send them a welcome email. You don't want to block the registration request, so you queue it as a background job.

```ts
const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

const client = await createClient({
  stateAdapter,
  registry: jobTypes,
});

await client.withNotify(async () =>
  db.transaction(async (tx) => {
    const user = await tx.users.create({
      name: "Alice",
      email: "alice@example.com",
    });

    await client.startJobChain({
      tx,
      typeName: "send-welcome-email",
      input: { userId: user.id, email: user.email, name: user.name },
    });
  }),
);
```

We scheduled the job inside a database transaction. This ensures that if the transaction rolls back (e.g., user creation fails), the job is not started. No orphaned emails. (Refer to transactional outbox pattern.)

Later, a background worker picks up the job and sends the email:

```ts
const worker = await createInProcessWorker({
  stateAdapter,
  registry: jobTypes,
  log: createConsoleLog(),
  processors: {
    "send-welcome-email": {
      attemptHandler: async ({ job, complete }) => {
        await sendEmail({
          to: job.input.email,
          subject: "Welcome!",
          body: `Hello ${job.input.name}, welcome to our platform!`,
        });

        return complete(async () => ({
          sentAt: new Date().toISOString(),
        }));
      },
    },
  },
});

await worker.start();
```

## It looks familiar, right?

This library is inspired by workflow engines like [Temporal](https://temporal.io/) and queue systems like [BullMQ](https://docs.bullmq.io/).

These tools are powerful, but they come with trade-offs:

- **Separate infrastructure** — Most queue systems require dedicated infrastructure (Redis, a workflow server, or a separate database) in addition to your application database. That's another system to deploy, monitor, and maintain.
- **Dual-write consistency** — Writing to your database and a separate queue in two steps risks inconsistency. If one operation fails, you end up with orphaned data or orphaned jobs.
- **Vendor lock-in** — When workflow state lives outside your database, migrating away means re-architecting your application.
- **Complexity** — Workflow engines often require deterministic code, have execution limits, and introduce concepts that can be overkill for many background job use cases.
- **Licensing & maintenance** — Some popular libraries have enterprise licensing requirements or have slowed in maintenance.

## Why Queuert?

- **Your database is the source of truth** — No separate persistence layer. Jobs live alongside your application data.
- **True transactional consistency** — Start jobs inside your database transactions. If the transaction rolls back, the job is never created. No dual-write problems.
- **No vendor lock-in** — Works with PostgreSQL and SQLite. Bring your own ORM (Kysely, Drizzle, Prisma, raw drivers).
- **Simple mental model** — Job chains work like Promise chains. No determinism requirements, no replay semantics to learn.
- **Full type safety** — TypeScript inference for inputs, outputs, continuations, and blockers. Catch errors at compile time.
- **Flexible notifications** — Use Redis, NATS, or PostgreSQL LISTEN/NOTIFY for low-latency. Or just poll—no extra infrastructure required.
- **MIT licensed** — No enterprise licensing concerns.

## Installation

```bash
# Core package (required)
npm install queuert

# State adapters (pick one)
npm install @queuert/postgres  # PostgreSQL - recommended for production
npm install @queuert/sqlite    # SQLite (experimental)

# Notify adapters (optional, for reduced latency)
npm install @queuert/redis     # Redis pub/sub - recommended for production
npm install @queuert/nats      # NATS pub/sub (experimental)
# Or use PostgreSQL LISTEN/NOTIFY via @queuert/postgres (no extra infra)

# Observability (optional)
npm install @queuert/otel      # OpenTelemetry metrics and histograms
```

## Core Concepts

### Job

An individual unit of work. Jobs have a lifecycle: `pending` → `running` → `completed`. Each job belongs to a Job Type and contains typed input/output. Jobs can also be `blocked` if they depend on other jobs to complete first.

### Job Chain

A chain of linked jobs where each job can `continueWith` to the next - just like a Promise chain. In fact, a chain IS its first job, the same way a Promise chain IS the first promise. When you call `startJobChain`, the returned `chain.id` is the first job's ID. Continuation jobs share this `chainId` but have their own unique `id`. The chain completes when its final job completes without continuing.

### Job Type

Defines a named job type with its input/output types and attempt handler function. Job types are registered with workers via the `processors` configuration. The attempt handler receives the job and context for completing or continuing the chain.

### State Adapter

Abstracts database operations for job persistence. Queuert provides adapters for PostgreSQL and SQLite. The adapter handles job creation, status transitions, leasing, and queries.

**Available adapters:**

- `@queuert/postgres` - PostgreSQL state adapter (recommended for production)
- `@queuert/sqlite` - SQLite state adapter _(experimental)_

### State Provider

Bridges your database client (Kysely, Drizzle, Prisma, raw pg, etc.) with the state adapter. You implement a simple interface that provides transaction handling and SQL execution.

### Notify Adapter

Handles pub/sub notifications for efficient job scheduling. When a job is created, workers are notified immediately instead of polling. This reduces latency from seconds to milliseconds.

**Available adapters:**

- `@queuert/redis` - Redis notify adapter (recommended for production)
- `@queuert/nats` - NATS notify adapter _(experimental)_
- `@queuert/postgres` - PostgreSQL notify adapter (uses LISTEN/NOTIFY, no additional infrastructure)
- None (default) - polling only, no real-time notifications

### Notify Provider

Bridges your pub/sub client (Redis, PostgreSQL, etc.) with the notify adapter. Similar to state providers, you implement an interface for publishing messages and subscribing to channels.

### Worker

Processes jobs by polling for available work. Workers automatically renew leases during long-running operations and handle retries with configurable backoff.

## Horizontal Scaling

Deploy multiple worker processes sharing the same database for horizontal scaling. Workers coordinate via database-level locking (`FOR UPDATE SKIP LOCKED`) — no external coordination required.

```ts
// Process A (e.g., machine-1)
const worker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry,
  workerId: "worker-a",
  concurrency: 10,
  processors: { ... },
});

// Process B (e.g., machine-2)
const worker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry,
  workerId: "worker-b",
  concurrency: 10,
  processors: { ... },
});
```

Each worker needs a unique `workerId`. Workers compete for available jobs — when one acquires a job, others skip it. The notify adapter (Redis, PostgreSQL LISTEN/NOTIFY, etc.) ensures workers wake up immediately when new jobs are queued.

See [examples/state-postgres-multi-worker](./examples/state-postgres-multi-worker) for a complete example spawning multiple worker processes sharing a PostgreSQL database.

## Job Processing Modes

Jobs support two processing modes via the `prepare` function:

### Atomic Mode

Prepare and complete run in ONE transaction. Use when reads and writes must be atomic.

```ts
'reserve-inventory': {
  attemptHandler: async ({ job, prepare, complete }) => {
    const item = await prepare({ mode: "atomic" }, async ({ sql }) => {
      const [row] = await sql`SELECT stock FROM items WHERE id = ${job.input.id}`;
      if (row.stock < 1) throw new Error("Out of stock");
      return row;
    });

    // Complete runs in SAME transaction as prepare
    return complete(async ({ sql }) => {
      await sql`UPDATE items SET stock = stock - 1 WHERE id = ${job.input.id}`;
      return { reserved: true };
    });
  },
}
```

### Staged Mode

Prepare and complete run in SEPARATE transactions. Use for external API calls or long-running operations that shouldn't hold a database transaction open.

```ts
'charge-payment': {
  attemptHandler: async ({ job, prepare, complete }) => {
    // Phase 1: Prepare (transaction)
    const order = await prepare({ mode: "staged" }, async ({ sql }) => {
      const [row] = await sql`SELECT * FROM orders WHERE id = ${job.input.id}`;
      return row;
    });
    // Transaction closed, lease renewal active

    // Phase 2: Processing (no transaction)
    const { paymentId } = await paymentAPI.charge(order.amount);

    // Phase 3: Complete (new transaction)
    return complete(async ({ sql }) => {
      await sql`UPDATE orders SET payment_id = ${paymentId} WHERE id = ${order.id}`;
      return { paymentId };
    });
  },
}
```

### Auto-Setup

If you don't call `prepare`, auto-setup runs based on when you call `complete`:

- Call `complete` synchronously → atomic mode
- Call `complete` after async work → staged mode (lease renewal active)

See [examples/showcase-processing-modes](./examples/showcase-processing-modes) for a complete working example demonstrating all three modes through an order fulfillment workflow.

## Job Chain Patterns

Chains support various execution patterns via `continueWith`:

### Linear

Jobs execute one after another: `create-subscription → activate-trial`

```ts
type Definitions = {
  'create-subscription': {
    entry: true;
    input: { userId: string; planId: string };
    continueWith: { typeName: 'activate-trial' };
  };
  'activate-trial': {
    input: { subscriptionId: number; trialDays: number };
    continueWith: { typeName: 'trial-decision' };
  };
};

// In processor
'create-subscription': {
  attemptHandler: async ({ job, complete }) => {
    return complete(async ({ sql, continueWith }) => {
      const [sub] = await sql`INSERT INTO subscriptions ... RETURNING id`;
      return continueWith({
        typeName: "activate-trial",
        input: { subscriptionId: sub.id, trialDays: 7 },
      });
    });
  },
},
```

### Branched

Jobs conditionally continue to different types: `trial-decision → convert-to-paid | expire-trial`

```ts
'trial-decision': {
  input: { subscriptionId: number };
  continueWith: { typeName: 'convert-to-paid' | 'expire-trial' };  // Union type
};

// In processor - choose path based on condition
'trial-decision': {
  attemptHandler: async ({ job, complete }) => {
    const shouldConvert = userWantsToConvert;
    return complete(async ({ continueWith }) => {
      return continueWith({
        typeName: shouldConvert ? "convert-to-paid" : "expire-trial",
        input: { subscriptionId: job.input.subscriptionId },
      });
    });
  },
},
```

### Loops

Jobs continue to the same type: `charge-billing → charge-billing → ... → done`

```ts
type Definitions = {
  'charge-billing': {
    input: { subscriptionId: number; cycle: number };
    output: { finalCycle: number; totalCharged: number };  // Terminal output
    continueWith: { typeName: 'charge-billing' };  // Self-reference for looping
  };
};

// In processor - loop or terminate with output
'charge-billing': {
  attemptHandler: async ({ job, complete }) => {
    await chargePayment(job.input.subscriptionId);
    return complete(async ({ continueWith }) => {
      if (job.input.cycle < MAX_CYCLES) {
        return continueWith({
          typeName: "charge-billing",
          input: { subscriptionId: job.input.subscriptionId, cycle: job.input.cycle + 1 },
        });
      }
      return { finalCycle: job.input.cycle, totalCharged: calculateTotal() };
    });
  },
},
```

### Go-to

Jobs jump to different types: `charge-billing → cancel-subscription`

```ts
type Definitions = {
  'charge-billing': {
    input: { subscriptionId: number; cycle: number };
    output: { finalCycle: number; totalCharged: number };
    continueWith: { typeName: 'charge-billing' | 'cancel-subscription' };  // Loop or jump
  };
  'cancel-subscription': {
    input: { subscriptionId: number; reason: string };
    output: { cancelledAt: string };
  };
};

// In processor - jump to cancel when max cycles reached
'charge-billing': {
  attemptHandler: async ({ job, complete }) => {
    return complete(async ({ continueWith }) => {
      if (job.input.cycle >= MAX_CYCLES) {
        return continueWith({
          typeName: "cancel-subscription",
          input: { subscriptionId: job.input.subscriptionId, reason: "max_billing_cycles_reached" },
        });
      }
      return continueWith({
        typeName: "charge-billing",
        input: { subscriptionId: job.input.subscriptionId, cycle: job.input.cycle + 1 },
      });
    });
  },
},
```

See [examples/showcase-chain-patterns](./examples/showcase-chain-patterns) for a complete working example demonstrating all four patterns through a subscription lifecycle workflow.

## Job Blockers

Jobs can depend on other job chains to complete before they start. A job with incomplete blockers starts as `blocked` and transitions to `pending` when all blockers complete.

```ts
type Definitions = {
  "fetch-data": {
    entry: true;
    input: { url: string };
    output: { data: string };
  };
  "process-all": {
    entry: true;
    input: { ids: string[] };
    output: { results: string[] };
    blockers: [{ typeName: "fetch-data" }, ...{ typeName: "fetch-data" }[]]; // Wait for multiple fetches (tuple with rest)
  };
};

// Start with blockers
const fetchBlockers = await Promise.all([
  queuert.startJobChain({ typeName: "fetch-data", input: { url: "/a" } }),
  queuert.startJobChain({ typeName: "fetch-data", input: { url: "/b" } }),
]);
await queuert.startJobChain({
  typeName: "process-all",
  input: { ids: ["a", "b", "c"] },
  blockers: fetchBlockers,
});

// Access completed blockers in worker
const worker = await createInProcessWorker({
  stateAdapter,
  registry: jobTypes,
  log: createConsoleLog(),
  processors: {
    "process-all": {
      attemptHandler: async ({ job, complete }) => {
        const results = job.blockers.map((b) => b.output.data);
        return complete(() => ({ results }));
      },
    },
  },
});

await worker.start();
```

See [examples/showcase-blockers](./examples/showcase-blockers) for a complete working example demonstrating fan-out/fan-in and fixed blocker slots.

## Error Handling

Queuert provides only job completion — there is no built-in "failure" state. This is intentional: you control how errors are represented in your job outputs.

Handle failures by returning error information in your output types:

```ts
type Definitions = {
  "process-payment": {
    entry: true;
    input: { orderId: string };
    output: { success: true; transactionId: string } | { success: false; error: string };
  };
};
```

For workflows that need rollback, use the compensation pattern — a "failed" job can continue to a compensation job that undoes previous steps:

```ts
type Definitions = {
  "charge-card": {
    entry: true;
    input: { orderId: string };
    continueWith: { typeName: "ship-order" | "refund-charge" };
  };
  "ship-order": {
    input: { orderId: string; chargeId: string };
    output: { shipped: true };
    continueWith: { typeName: "refund-charge" }; // Can continue to refund on failure
  };
  "refund-charge": {
    input: { chargeId: string };
    output: { refunded: true };
  };
};
```

### Explicit Rescheduling

When a job throws an error, it's automatically rescheduled with exponential backoff. For transient failures where you want explicit control over retry timing, use `rescheduleJob`:

```ts
import { rescheduleJob } from "queuert";

const worker = await createInProcessWorker({
  stateAdapter,
  registry: jobTypes,
  log: createConsoleLog(),
  processors: {
    "call-external-api": {
      attemptHandler: async ({ job, prepare, complete }) => {
        const response = await fetch(job.input.url);

        if (response.status === 429) {
          // Rate limited — retry after the specified delay
          const retryAfter = parseInt(response.headers.get("Retry-After") || "60", 10);
          rescheduleJob({ afterMs: retryAfter * 1000 });
        }

        if (!response.ok) {
          // Other errors use default exponential backoff
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        return complete(() => ({ data }));
      },
    },
  },
});

await worker.start();
```

The `rescheduleJob` function throws a `RescheduleJobError` which the worker catches specially. Unlike regular errors that trigger exponential backoff based on attempt count, `rescheduleJob` uses your specified schedule exactly:

```ts
// Retry after a delay
rescheduleJob({ afterMs: 30_000 }); // 30 seconds from now

// Retry at a specific time
rescheduleJob({ at: new Date("2025-01-15T09:00:00Z") });

// Include the original error as cause (for logging/debugging)
rescheduleJob({ afterMs: 60_000 }, originalError);
```

See [examples/showcase-error-handling](./examples/showcase-error-handling) for a complete working example demonstrating discriminated unions, compensation patterns, and explicit rescheduling.

## Deferred Start

Jobs can be scheduled to start at a future time using the `schedule` option. The job is created transactionally but won't be processed until the specified time.

```ts
// Schedule a job to run in 5 minutes
await client.startJobChain({
  typeName: "send-reminder",
  input: { userId: "123" },
  schedule: { afterMs: 5 * 60 * 1000 }, // 5 minutes from now
});

// Or schedule at a specific time
await client.startJobChain({
  typeName: "send-reminder",
  input: { userId: "123" },
  schedule: { at: new Date("2025-01-15T09:00:00Z") },
});
```

The same `schedule` option works with `continueWith` for deferred continuations:

```ts
return complete(async ({ continueWith }) =>
  continueWith({
    typeName: "follow-up",
    input: { userId: job.input.userId },
    schedule: { afterMs: 24 * 60 * 60 * 1000 }, // 24 hours later
  }),
);
```

### Recurring Jobs

For periodic tasks like daily digests, health checks, or billing cycles, use loop chains with scheduled continuations. The job continues to itself with a delay — no external cron job needed.

```ts
type Definitions = {
  'daily-digest': {
    entry: true;
    input: { userId: string };
    output: { unsubscribedAt: string };
    continueWith: { typeName: 'daily-digest' };  // Self-reference for looping
  };
};

// In processor — loop with scheduled delay
'daily-digest': {
  attemptHandler: async ({ job, complete }) => {
    await sendDigestEmail(job.input.userId);

    return complete(async ({ continueWith }) => {
      if (userStillSubscribed) {
        return continueWith({
          typeName: 'daily-digest',
          input: { userId: job.input.userId },
          schedule: { afterMs: 24 * 60 * 60 * 1000 }, // Run again tomorrow
        });
      }
      return { unsubscribedAt: new Date().toISOString() };
    });
  },
}
```

See [examples/showcase-scheduling](./examples/showcase-scheduling) for a complete working example demonstrating recurring jobs with scheduling and deduplication.

## Deduplication

Deduplication prevents duplicate job chains from being created. When you start a job chain with a deduplication key, Queuert checks if a chain with that key already exists and returns the existing chain instead of creating a new one.

```ts
// First call creates the chain
const chain1 = await client.startJobChain({
  typeName: "sync-user",
  input: { userId: "123" },
  deduplication: { key: "sync:user:123" },
});

// Second call with same key returns existing chain
const chain2 = await client.startJobChain({
  typeName: "sync-user",
  input: { userId: "123" },
  deduplication: { key: "sync:user:123" },
});

chain2.deduplicated; // true — returned existing chain
chain2.id === chain1.id; // true
```

### Deduplication Modes

The `scope` option controls what jobs to check for duplicates:

- **`incomplete`** (default) — Only dedup against incomplete chains (allows new chain after previous completes)
- **`any`** — Dedup against any existing chain with this key

```ts
// Only one active health check at a time, but can start new after completion
await client.startJobChain({
  typeName: "health-check",
  input: { serviceId: "api-server" },
  deduplication: {
    key: "health:api-server",
    scope: "incomplete",
  },
});
```

### Time-Windowed Deduplication

Use `windowMs` to rate-limit job creation. Duplicates are prevented only within the time window.

```ts
// No duplicate syncs within 1 hour
await client.startJobChain({
  typeName: "sync-data",
  input: { sourceId: "db-primary" },
  deduplication: {
    key: "sync:db-primary",
    scope: "any",
    windowMs: 60 * 60 * 1000, // 1 hour
  },
});
```

See [examples/showcase-scheduling](./examples/showcase-scheduling) for a complete working example demonstrating deduplication with recurring jobs.

## Workerless Completion

Jobs can be completed without a worker using `completeJobChain`. This enables approval workflows, webhook-triggered completions, and patterns where jobs wait for external events. Deferred start pairs well with this — schedule a job to auto-reject after a timeout, but allow early completion based on user action.

```ts
type Definitions = {
  "await-approval": {
    entry: true;
    input: { requestId: string };
    output: { rejected: true };
    continueWith: { typeName: "process-request" };
  };
  "process-request": {
    input: { requestId: string };
    output: { processed: true };
  };
};

// Start a job that auto-rejects in 2 hours if not handled
const chain = await queuert.startJobChain({
  typeName: "await-approval",
  input: { requestId: "123" },
  schedule: { afterMs: 2 * 60 * 60 * 1000 }, // 2 hours
});

// The worker handles the timeout case (auto-reject) and processes approved requests
const worker = await createInProcessWorker({
  stateAdapter,
  registry: jobTypes,
  log: createConsoleLog(),
  processors: {
    "await-approval": {
      attemptHandler: async ({ complete }) => complete(() => ({ rejected: true })),
    },
    "process-request": {
      attemptHandler: async ({ job, complete }) => {
        await doSomethingWith(job.input.requestId);
        return complete(() => ({ processed: true }));
      },
    },
  },
});

await worker.start();

// The job can be completed early without a worker (e.g., via API call)
await queuert.completeJobChain({
  id: chain.id,
  typeName: "await-approval",
  complete: async ({ job, complete }) => {
    if (job.typeName !== "await-approval") {
      return; // Already past approval stage
    }
    // If approved, continue to process-request; otherwise just reject
    if (userApproved) {
      await complete(job, ({ continueWith }) =>
        continueWith({
          typeName: "process-request",
          input: { requestId: job.input.requestId },
        }),
      );
    } else {
      await complete(job, () => ({ rejected: true }));
    }
  },
});
```

This pattern lets you interweave external actions with your job chains — waiting for user input, third-party callbacks, or manual approval steps.

See [examples/showcase-workerless](./examples/showcase-workerless) for a complete working example demonstrating approval workflows and deferred start with early completion.

## Complete Type Safety

Queuert provides end-to-end type safety with full type inference. Define your job types once, and TypeScript ensures correctness throughout your entire codebase:

- **Job inputs and outputs** are inferred and validated at compile time
- **Continuations** are type-checked — `continueWith` only accepts valid target job types with matching inputs
- **Blockers** are fully typed — access `job.blockers` with correct output types for each blocker
- **Internal job types** without `entry: true` cannot be started directly via `startJobChain`

No runtime type errors. No mismatched job names. Your workflow logic is verified before your code ever runs.

## Runtime Validation

For production APIs accepting external input, you can add runtime validation using any schema library (Zod, Valibot, TypeBox, etc.). The core is minimal — schema-specific adapters are implemented in user-land.

Both `defineJobTypes` (compile-time only) and `createJobTypeRegistry` (runtime validation) provide the same compile-time type safety. Runtime validation adds protection against invalid external data.

See complete adapter examples: [Zod](./examples/validation-zod), [Valibot](./examples/validation-valibot), [TypeBox](./examples/validation-typebox), [ArkType](./examples/validation-arktype).

## Timeouts

For cooperative timeouts, combine `AbortSignal.timeout()` with the provided `signal`:

```ts
const worker = await createInProcessWorker({
  stateAdapter,
  registry: jobTypes,
  log: createConsoleLog(),
  processors: {
    "fetch-data": {
      attemptHandler: async ({ signal, job, complete }) => {
        const timeout = AbortSignal.timeout(30_000); // 30 seconds
        const combined = AbortSignal.any([signal, timeout]);

        // Use combined signal for cancellable operations
        const response = await fetch(job.input.url, { signal: combined });
        const data = await response.json();

        return complete(() => ({ data }));
      },
    },
  },
});

await worker.start();
```

For hard timeouts, configure `leaseConfig` in the job type processor — if a job doesn't complete or renew its lease in time, the reaper reclaims it for retry:

```ts
const worker = await createInProcessWorker({
  stateAdapter,
  registry: jobTypes,
  log: createConsoleLog(),
  processors: {
    'long-running-job': {
      leaseConfig: { leaseMs: 300_000, renewIntervalMs: 60_000 }, // 5 min lease
      attemptHandler: async ({ job, complete }) => { ... },
    },
  },
});
```

See [examples/showcase-timeouts](./examples/showcase-timeouts) for a complete working example demonstrating cooperative timeouts and hard timeouts via lease.

## Observability

Queuert provides an OpenTelemetry adapter for metrics collection. Configure your OTEL SDK with desired exporters (Prometheus, OTLP, Jaeger, etc.) before using this adapter.

```ts
import { createOtelObservabilityAdapter } from "@queuert/otel";
import { metrics } from "@opentelemetry/api";

const client = await createClient({
  stateAdapter,
  registry: jobTypes,
  observabilityAdapter: createOtelObservabilityAdapter({
    meter: metrics.getMeter("my-app"),
  }),
  log: createConsoleLog(),
});
```

The adapter emits:

- **Counters:** worker lifecycle, job attempts, completions, errors
- **Histograms:** job duration, chain duration, attempt duration
- **Gauges:** idle workers per job type, jobs being processed

See [examples/observability-otel](./examples/observability-otel) for a complete example.

## Testing & Resilience

Queuert includes comprehensive test suites that verify job execution guarantees under various failure conditions. The resilience tests simulate transient database errors to ensure jobs complete successfully even when infrastructure is unreliable.

Test suites available in [`packages/core/src/suites/`](./packages/core/src/suites/):

- [`process.test-suite.ts`](./packages/core/src/suites/process.test-suite.ts) — Atomic/staged modes, prepare/complete patterns
- [`chains.test-suite.ts`](./packages/core/src/suites/chains.test-suite.ts) — Linear, branched, loop, go-to patterns
- [`blocker-chains.test-suite.ts`](./packages/core/src/suites/blocker-chains.test-suite.ts) — Job dependencies and blocking
- [`workerless-completion.test-suite.ts`](./packages/core/src/suites/workerless-completion.test-suite.ts) — External job completion
- [`scheduling.test-suite.ts`](./packages/core/src/suites/scheduling.test-suite.ts) — Scheduled job execution and rescheduling
- [`deduplication.test-suite.ts`](./packages/core/src/suites/deduplication.test-suite.ts) — Duplicate job prevention
- [`deletion.test-suite.ts`](./packages/core/src/suites/deletion.test-suite.ts) — Job chain deletion
- [`wait-chain-completion.test-suite.ts`](./packages/core/src/suites/wait-chain-completion.test-suite.ts) — Waiting for chain completion
- [`notify.test-suite.ts`](./packages/core/src/suites/notify.test-suite.ts) — Notification adapter tests
- [`notify-resilience.test-suite.ts`](./packages/core/src/suites/notify-resilience.test-suite.ts) — Notification resilience under failures
- [`state-resilience.test-suite.ts`](./packages/core/src/suites/state-resilience.test-suite.ts) — Transient error handling
- [`reaper.test-suite.ts`](./packages/core/src/suites/reaper.test-suite.ts) — Expired lease reclamation
- [`worker.test-suite.ts`](./packages/core/src/suites/worker.test-suite.ts) — Worker lifecycle and polling

These suites run against all supported adapters (PostgreSQL, SQLite, in-memory) to ensure consistent behavior across databases.

## Benchmarks

Queuert adapters add minimal overhead on top of the database/messaging drivers (Node.js v24, `--expose-gc`):

| State Adapter | Adapter Overhead |
| ------------- | ---------------- |
| PostgreSQL    | ~290 KB          |
| SQLite        | ~45 KB           |

| Notify Adapter | Adapter Overhead |
| -------------- | ---------------- |
| Redis          | ~11 KB           |
| PostgreSQL     | ~10 KB           |
| NATS           | ~11 KB           |

| Component             | Overhead |
| --------------------- | -------- |
| Observability Adapter | ~145 KB  |

See [examples/benchmark-memory-footprint](./examples/benchmark-memory-footprint) for the full measurement tool.

## License

MIT
