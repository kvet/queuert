# Tracing Design

## Overview

This document describes Queuert's distributed tracing design using OpenTelemetry. Tracing provides end-to-end visibility into job chain execution, including job dependencies, retry attempts, and blocker relationships.

## Span Hierarchy

Queuert uses a four-level span hierarchy following OpenTelemetry messaging semantic conventions:

```
PRODUCER: chain              ← Chain published (ends immediately)
│
├── PRODUCER: job            ← Job published (ends immediately)
│   │
│   ├── CONSUMER: attempt    ← Worker processes attempt (has duration)
│   │   ├── INTERNAL: prepare
│   │   └── INTERNAL: complete
│   │
│   └── CONSUMER: attempt    ← Retry attempt
│       ├── INTERNAL: prepare
│       └── INTERNAL: complete
│
├── PRODUCER: job            ← Continuation job
│   │
│   └── CONSUMER: attempt
│       ├── INTERNAL: prepare
│       └── INTERNAL: complete (final)
│           │
│           └── CONSUMER: chain   ← Chain consumed (ends immediately)
```

### Span Kinds

| Span              | Kind     | Semantics                                 |
| ----------------- | -------- | ----------------------------------------- |
| **chain** (start) | PRODUCER | Chain is published to the queue           |
| **job**           | PRODUCER | Job is published/scheduled for processing |
| **attempt**       | CONSUMER | Worker consumes and processes the job     |
| **prepare**       | INTERNAL | Internal phase within attempt             |
| **complete**      | INTERNAL | Internal phase within attempt             |
| **chain** (end)   | CONSUMER | Chain is fully consumed/completed         |

The PRODUCER/CONSUMER pairing follows OpenTelemetry messaging conventions:

- PRODUCER spans represent publishing work to a queue
- CONSUMER spans represent processing work from a queue
- The chain has both a PRODUCER (creation) and CONSUMER (completion) span for symmetry

### Span Lifecycle

| Span              | Created                             | Ended                   | Typical Duration |
| ----------------- | ----------------------------------- | ----------------------- | ---------------- |
| **chain** (start) | `startJobChain()`                   | Immediately             | ~0ms             |
| **job**           | `startJobChain()`, `continueWith()` | Immediately             | ~0ms             |
| **attempt**       | Worker claims job                   | Attempt completes/fails | Processing time  |
| **prepare**       | `prepare()` called                  | `prepare()` returns     | Transaction time |
| **complete**      | `complete()` called                 | `complete()` returns    | Transaction time |
| **chain** (end)   | Final job completes                 | Immediately             | ~0ms             |

PRODUCER spans end immediately (publish semantics), while CONSUMER spans have duration (processing semantics).

## Trace Context Storage

Trace context is stored in job state to enable span linking across workers and processes.

### State Schema

```typescript
type StateJob = {
  // ... existing fields

  /**
   * W3C traceparent format: "00-{traceId}-{spanId}-{flags}"
   * Context of the PRODUCER chain span.
   * Same value for all jobs in the same chain.
   */
  chainTraceContext: string | null;

  /**
   * W3C traceparent format: "00-{traceId}-{spanId}-{flags}"
   * Context of this job's PRODUCER span.
   * Used by attempts to create child CONSUMER spans.
   */
  jobTraceContext: string | null;
};
```

### Context Propagation

```
startJobChain:
  1. Create PRODUCER chain span → store in chainTraceContext
  2. Create PRODUCER job span (child of chain) → store in jobTraceContext
  3. Both contexts saved with job

continueWith:
  1. Inherit chainTraceContext from current job
  2. Create new PRODUCER job span (child of chain) → store in new job's jobTraceContext
  3. Link new job span to origin attempt span

Worker processes job:
  1. Read jobTraceContext from job
  2. Create CONSUMER attempt span (child of job)
  3. Create INTERNAL prepare/complete spans (children of attempt)

Chain completes:
  1. Create CONSUMER chain span (child of final attempt)
  2. Link to PRODUCER chain span
```

## Blocker Relationships

When a job has blockers (dependencies on other chains), span links capture the relationship:

```
Blocker Chain A:
PRODUCER: chain fetch-user ─────────────────────────────
└── PRODUCER: job fetch-user
    └── CONSUMER: attempt ✓

Blocker Chain B:
PRODUCER: chain fetch-inventory ────────────────────────
└── PRODUCER: job fetch-inventory
    └── CONSUMER: attempt ✓

Main Chain:
PRODUCER: chain process-order ──────────────────────────
│   (created with status: blocked)
│
└── PRODUCER: job process-order
    │   links: [chain fetch-user, chain fetch-inventory]  ← blocker links
    │
    └── CONSUMER: attempt
        │   job.blockers contains resolved blocker outputs
        ├── INTERNAL: prepare
        └── INTERNAL: complete ✓
```

Blocker links enable tracing tools to show:

- Which chains a job waited for
- The dependency graph between chains
- Total time spent blocked

## Continuation Relationships

When a job continues to another job via `continueWith`, the continuation links to its origin:

```
PRODUCER: chain multi-step ─────────────────────────────
│
├── PRODUCER: job step-one
│   └── CONSUMER: attempt #1
│       ├── INTERNAL: prepare
│       └── INTERNAL: complete
│           └── (calls continueWith)
│
└── PRODUCER: job step-two
    │   links: [attempt step-one #1]  ← origin link
    │
    └── CONSUMER: attempt #1
        ├── INTERNAL: prepare
        └── INTERNAL: complete (final)
            │
            └── CONSUMER: chain multi-step
```

The origin link shows the causal flow: "step-two was created by step-one's completion".

## Interface Design

### ObservabilityAdapter Extensions

```typescript
type ObservabilityAdapter = {
  // ... existing metrics methods ...

  /**
   * Creates PRODUCER chain span (ends immediately).
   * Called on startJobChain.
   * Returns W3C traceparent string to store in chainTraceContext.
   */
  createChainProducerSpan: (data: ChainSpanData) => string | undefined;

  /**
   * Creates PRODUCER job span as child of chain (ends immediately).
   * Called on startJobChain and continueWith.
   * Returns W3C traceparent string to store in jobTraceContext.
   */
  createJobProducerSpan: (data: JobSpanData) => string | undefined;

  /**
   * Starts CONSUMER attempt span as child of job.
   * Called when worker begins processing.
   * Returns handle to manage attempt lifecycle.
   */
  startAttemptConsumerSpan: (data: AttemptSpanData) => AttemptSpanHandle | undefined;
};
```

### Span Data Types

```typescript
type ChainSpanData = {
  // Parent context (for nested/blocker chains where rootChainId !== null)
  rootChainTraceContext?: string;

  // Identity
  chainId: string;
  chainTypeName: string;
  rootChainId: string | null;

  // Content
  input: unknown;
};

type JobSpanData = {
  // Parent context
  chainTraceContext: string;

  // Identity
  chainId: string;
  chainTypeName: string;
  rootChainId: string | null;
  jobId: string;
  jobTypeName: string;

  // Content
  input: unknown;

  // Blockers (IDs for attributes, trace contexts for links)
  blockerChainIds?: string[];
  blockerChainTraceContexts?: string[];

  // Continuation link
  originId: string | null;
  originAttemptTraceContext?: string;
};

type AttemptSpanData = {
  // Parent context
  jobTraceContext: string;

  // Identity
  chainId: string;
  chainTypeName: string;
  jobId: string;
  jobTypeName: string;
  attempt: number;
  workerId: string;
};
```

### Span Handles

```typescript
type AttemptSpanHandle = {
  /**
   * Returns trace context for this attempt.
   * Used by continueWith to link continuation job to origin attempt.
   */
  getTraceContext: () => string;

  /** Starts INTERNAL prepare span as child of attempt */
  startPrepare: () => SpanHandle;

  /** Starts INTERNAL complete span as child of attempt */
  startComplete: () => SpanHandle;

  /**
   * Ends the attempt span.
   * If chainCompleted is provided, also creates CONSUMER chain span.
   */
  end: (result: AttemptSpanResult) => void;
};

type SpanHandle = {
  end: () => void;
};

type AttemptSpanResult = {
  status: "completed" | "failed" | "retry";
  error?: unknown;
  continued?: {
    jobId: string;
    jobTypeName: string;
  };
  chainCompleted?: {
    chainTraceContext: string;
    chainId: string;
    chainTypeName: string;
    output: unknown;
  };
};
```

For implementation details including OTEL adapter code, helper functions, and integration examples, see [Tracing Implementation](observability-tracing.implementation.md).

## Visualization

### Jaeger/Tempo View

```
Trace: abc-123-def-456 (process-order)

PRODUCER chain process-order [0ms] ───────────────────────────────
│   @0ms
│
├── PRODUCER job validate-order [0ms] ────────────────────────────
│   │   @0ms, parent: chain
│   │
│   └── CONSUMER job-attempt validate-order #1 [500ms] ───────────
│       │   @10ms, parent: job
│       ├── INTERNAL prepare [20ms]
│       └── INTERNAL complete [450ms]
│
├── PRODUCER job charge-payment [0ms] ────────────────────────────
│   │   @520ms, parent: chain
│   │   links: [validate-order attempt #1]
│   │
│   ├── CONSUMER job-attempt charge-payment #1 [1000ms] ✗ ────────
│   │   │   @530ms, parent: job
│   │   ├── INTERNAL prepare [10ms]
│   │   └── INTERNAL complete [900ms] ERROR: payment declined
│   │
│   └── CONSUMER job-attempt charge-payment #2 [800ms] ───────────
│       │   @1600ms, parent: job
│       ├── INTERNAL prepare [10ms]
│       └── INTERNAL complete [750ms]
│
├── PRODUCER job ship-order [0ms] ────────────────────────────────
│   │   @2410ms, parent: chain
│   │   links: [charge-payment attempt #2]
│   │
│   └── CONSUMER job-attempt ship-order #1 [600ms] ───────────────
│       │   @2420ms, parent: job
│       ├── INTERNAL prepare [10ms]
│       └── INTERNAL complete [550ms]
│           │
│           └── CONSUMER chain process-order [0ms] ───────────────
│                   @3020ms, links: [PRODUCER chain]
```

### With Blockers

When blockers are started via `startBlockers`, they link back to the root chain:

```
Trace: main (process-order)

PRODUCER chain process-order [0ms] ──────────────────────────────
│   rootChainId: null (top-level chain)
│
├── PRODUCER chain fetch-user [0ms] ─────────────────────────────
│   │   rootChainId: process-order
│   │   links: [chain process-order]  ← links to root chain
│   │
│   └── PRODUCER job fetch-user [0ms]
│       └── CONSUMER job-attempt #1 [200ms] ✓
│
├── PRODUCER chain fetch-inventory [0ms] ────────────────────────
│   │   rootChainId: process-order
│   │   links: [chain process-order]  ← links to root chain
│   │
│   └── PRODUCER job fetch-inventory [0ms]
│       └── CONSUMER job-attempt #1 [150ms] ✓
│
└── PRODUCER job process-order [0ms]
    │   links: [chain fetch-user, chain fetch-inventory]  ← blocker links
    │
    └── CONSUMER job-attempt #1 [500ms]
        │   started after blockers completed
        ├── INTERNAL prepare
        │   job.blockers = [fetchUserResult, fetchInventoryResult]
        └── INTERNAL complete ✓
```

All spans share the same `traceId`, showing the complete workflow in one trace.

## Span Attributes

### Chain Spans

| Attribute                    | Type    | Description                                      |
| ---------------------------- | ------- | ------------------------------------------------ |
| `messaging.operation.name`   | string  | `"publish"` (producer) or `"process"` (consumer) |
| `messaging.destination.name` | string  | Chain type name                                  |
| `queuert.chain.id`           | string  | Chain ID                                         |
| `queuert.chain.type`         | string  | Chain type name                                  |
| `queuert.chain.root_id`      | string? | Root chain ID (null for top-level chains)        |

### Job Spans

| Attribute                       | Type      | Description                       |
| ------------------------------- | --------- | --------------------------------- |
| `messaging.operation.name`      | string    | `"publish"`                       |
| `messaging.destination.name`    | string    | Job type name                     |
| `queuert.chain.id`              | string    | Chain ID                          |
| `queuert.chain.type`            | string    | Chain type name                   |
| `queuert.job.id`                | string    | Job ID                            |
| `queuert.job.type`              | string    | Job type name                     |
| `queuert.job.origin_id`         | string?   | Origin job ID (for continuations) |
| `queuert.job.blocker_chain_ids` | string[]? | Blocker chain IDs (if blocked)    |

### Attempt Spans

| Attribute                         | Type    | Description                             |
| --------------------------------- | ------- | --------------------------------------- |
| `messaging.operation.name`        | string  | `"process"`                             |
| `messaging.destination.name`      | string  | Job type name                           |
| `messaging.consumer.group.name`   | string  | Worker ID                               |
| `queuert.chain.id`                | string  | Chain ID                                |
| `queuert.chain.type`              | string  | Chain type name                         |
| `queuert.job.id`                  | string  | Job ID                                  |
| `queuert.job.type`                | string  | Job type name                           |
| `queuert.job.attempt`             | number  | Attempt number (1-based)                |
| `queuert.worker.id`               | string  | Worker ID                               |
| `queuert.attempt.result`          | string  | `"completed"`, `"failed"`, or `"retry"` |
| `queuert.continued_with.job_id`   | string? | Continuation job ID                     |
| `queuert.continued_with.job_type` | string? | Continuation job type                   |

## Chain Duration Measurement

With PRODUCER chain at start and CONSUMER chain at end, total chain duration is calculated as:

```
Chain Duration = CONSUMER chain.startTime - PRODUCER chain.startTime
```

This provides end-to-end visibility even though individual PRODUCER/CONSUMER spans are instantaneous markers.

## Summary

Queuert's tracing design provides:

1. **Symmetric chain spans**: PRODUCER at creation, CONSUMER at completion
2. **Hierarchical job spans**: Chain → Job → Attempt → prepare/complete
3. **Blocker visibility**: Span links show dependencies between chains
4. **Continuation tracking**: Span links connect jobs in a chain
5. **Retry visibility**: Multiple attempt spans under each job
6. **Cross-worker correlation**: Trace context stored in job state
7. **Optional integration**: Returns `undefined` when tracing disabled

See also:

- [Tracing Implementation](observability-tracing.implementation.md) - OTEL adapter code and integration examples
- [Job Chain Model](job-chain-model.md) - Chain identity and continuation model
- [Job Processing](job-processing.md) - Prepare/complete pattern
- [Adapters](adapters.md) - ObservabilityAdapter design
- [Worker](worker.md) - Worker lifecycle and attempt handling
