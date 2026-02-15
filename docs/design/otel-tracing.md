# OTEL Tracing

## Overview

This document describes Queuert's OpenTelemetry tracing implementation. For the adapter interface, see [ObservabilityAdapter](observability-adapter.md). Tracing provides end-to-end visibility into job chain execution, including job dependencies, retry attempts, and blocker relationships.

## Span Hierarchy

Queuert uses a four-level span hierarchy:

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
│   └── CONSUMER: attempt (final)
│       ├── INTERNAL: prepare
│       ├── INTERNAL: complete
│       └── CONSUMER: chain  ← Chain consumed (created on attempt success)
```

Span kinds use OpenTelemetry's PRODUCER/CONSUMER/INTERNAL semantics. The chain has both a PRODUCER (creation) and CONSUMER (completion) span for symmetry.

| Span              | Kind     | Created                             | Ended                   | Duration         |
| ----------------- | -------- | ----------------------------------- | ----------------------- | ---------------- |
| **chain** (start) | PRODUCER | `startJobChain()`                   | Immediately             | ~0ms             |
| **job**           | PRODUCER | `startJobChain()`, `continueWith()` | Immediately             | ~0ms             |
| **attempt**       | CONSUMER | Worker claims job                   | Attempt completes/fails | Processing time  |
| **prepare**       | INTERNAL | `prepare()` called                  | `prepare()` returns     | Transaction time |
| **complete**      | INTERNAL | `complete()` called                 | `complete()` returns    | Transaction time |
| **job** (end)     | CONSUMER | Workerless completion               | Immediately             | ~0ms             |
| **chain** (end)   | CONSUMER | Final job completes                 | Immediately             | ~0ms             |

## Trace Context Propagation

Trace context is stored in job state (`traceContext` field) to enable span linking across workers and processes. The structure is adapter-specific—the OTEL adapter uses W3C traceparent format while core treats it as opaque `unknown`.

Context flows through the system:

- **Chain start**: Creates chain and job spans, stores context with job
- **Continuation**: Inherits chain context, creates new job span, links to origin
- **Worker processing**: Creates attempt span as child of job, updates context
- **Chain completion**: Creates CONSUMER chain span linked to PRODUCER chain

## Deduplication

When `startJobChain` is called with deduplication options and a matching chain already exists, no new chain is created. The span must reflect this outcome correctly.

Deduplication is **not an error**—it's expected behavior that successfully returned an existing chain. Per [OpenTelemetry status conventions](https://opentelemetry.io/docs/specs/otel/trace/api/#set-status), the span status should remain `UNSET` (not `ERROR`), with an attribute indicating deduplication occurred.

### Span Behavior

When deduplication occurs:

1. Adds attribute `queuert.chain.deduplicated: true`
2. References the existing chain's IDs
3. Optionally links to the existing chain's trace context

### Visualization

```
Caller requests startJobChain with deduplication key "user-123":

First call (creates new chain):
PRODUCER chain process-user [0ms] ──────────────────────
│   queuert.chain.id: "abc-123"
│   queuert.chain.deduplicated: false
│
└── ... (normal processing)

Second call (deduplicated):
PRODUCER chain process-user [0ms] ──────────────────────
    queuert.chain.id: "abc-123"  ← same as existing
    queuert.chain.deduplicated: true
    links: [chain abc-123]  ← link to existing chain
```

## Blocker Relationships

When a job has blockers (dependencies on other chains), the relationship is captured through two mechanisms:

1. **Span links**: Each blocker chain's PRODUCER span (and its job span) links back to the blocked job's span via `rootChainTraceContext`
2. **Root chain ID**: Blocker chain spans carry `queuert.chain.root_id` identifying the chain they block for

The parent-child hierarchy depends on the OTel active context at creation time. In the common case of a top-level `startJobChain` with `startBlockers`, all chains share the caller's active span as parent:

```
EXTERNAL span (e.g., HTTP request)
│
├── PRODUCER: chain process-order ──────────────────────
│   │
│   └── PRODUCER: job process-order
│       │   (created with status: blocked)
│       │
│       └── CONSUMER: attempt
│           │   job.blockers contains resolved blocker outputs
│           ├── INTERNAL: prepare
│           ├── INTERNAL: complete ✓
│           └── CONSUMER: chain process-order
│
├── PRODUCER: chain fetch-user ─────────────────────────
│   │   queuert.chain.root_id: <process-order chain id>
│   │   links: [job process-order]
│   │
│   └── PRODUCER: job fetch-user
│       │   links: [job process-order]
│       │
│       └── CONSUMER: attempt ✓
│           ├── INTERNAL: prepare
│           ├── INTERNAL: complete
│           └── CONSUMER: chain fetch-user
│
└── PRODUCER: chain fetch-inventory ────────────────────
    │   queuert.chain.root_id: <process-order chain id>
    │   links: [job process-order]
    │
    └── PRODUCER: job fetch-inventory
        │   links: [job process-order]
        │
        └── CONSUMER: attempt ✓
            ├── INTERNAL: prepare
            ├── INTERNAL: complete
            └── CONSUMER: chain fetch-inventory
```

The span links enable tracing tools to:

- Navigate from blocker chains to the job they unblock
- Show the dependency graph through link traversal
- Track total time from request start to completion

## Continuation Relationships

When a job continues to another job via `continueWith`, the continuation links to its origin:

```
PRODUCER: chain multi-step ─────────────────────────────
│
├── PRODUCER: job step-one
│   └── CONSUMER: attempt #1
│       ├── INTERNAL: prepare
│       └── INTERNAL: complete (calls continueWith)
│
└── PRODUCER: job step-two
    │   links: [job step-one]  ← origin link
    │
    └── CONSUMER: attempt #1 (final)
        ├── INTERNAL: prepare
        ├── INTERNAL: complete
        └── CONSUMER: chain multi-step
```

The origin link shows the causal flow: "step-two was created by step-one's completion".

## Workerless Completion

When a job is completed via `completeJobChain` (without a worker), there is no attempt. Instead, a CONSUMER job span marks the completion, and if the chain is fully completed, a CONSUMER chain span closes the trace:

```
PRODUCER: chain approve-order ──────────────────────────
│
└── PRODUCER: job approve-order
    │
    └── CONSUMER: job approve-order  ← Workerless completion
        │
        └── CONSUMER: chain approve-order
```

The CONSUMER job span is a child of the PRODUCER job span and carries the same chain/job attributes. When `continueWith` is called during workerless completion, the CONSUMER chain span is omitted (the chain continues):

```
PRODUCER: chain multi-step ─────────────────────────────
│
├── PRODUCER: job step-one
│   │
│   └── CONSUMER: job step-one  ← Workerless completion (continueWith)
│
└── PRODUCER: job step-two
    │   links: [job step-one]
    │
    └── ...
```

This uses the `completeJobSpan` adapter method rather than `startAttemptSpan`, reflecting that no attempt processing occurred.

## Span Attributes

### Chain Spans

| Attribute                    | Type     | Description                               |
| ---------------------------- | -------- | ----------------------------------------- |
| `queuert.chain.id`           | string   | Chain ID                                  |
| `queuert.chain.type`         | string   | Chain type name                           |
| `queuert.chain.root_id`      | string?  | Root chain ID (null for top-level chains) |
| `queuert.chain.deduplicated` | boolean? | `true` if existing chain was returned     |

### Job Spans

| Attribute                       | Type      | Description                           |
| ------------------------------- | --------- | ------------------------------------- |
| `queuert.chain.id`              | string    | Chain ID                              |
| `queuert.chain.type`            | string    | Chain type name                       |
| `queuert.chain.deduplicated`    | boolean?  | `true` if existing chain was returned |
| `queuert.job.id`                | string    | Job ID                                |
| `queuert.job.type`              | string    | Job type name                         |
| `queuert.job.origin_id`         | string?   | Origin job ID (for continuations)     |
| `queuert.job.blocker_chain_ids` | string[]? | Blocker chain IDs (if blocked)        |

### Attempt Spans

| Attribute                         | Type    | Description                           |
| --------------------------------- | ------- | ------------------------------------- |
| `queuert.chain.id`                | string  | Chain ID                              |
| `queuert.chain.type`              | string  | Chain type name                       |
| `queuert.job.id`                  | string  | Job ID                                |
| `queuert.job.type`                | string  | Job type name                         |
| `queuert.job.attempt`             | number  | Attempt number (1-based)              |
| `queuert.worker.id`               | string  | Worker ID                             |
| `queuert.attempt.result`          | string  | `"completed"` or `"failed"`           |
| `queuert.continued_with.job_id`   | string? | Continuation job ID                   |
| `queuert.continued_with.job_type` | string? | Continuation job type                 |
| `queuert.rescheduled_at`          | string? | ISO timestamp when retry is scheduled |
| `queuert.rescheduled_after_ms`    | number? | Delay in ms before retry              |

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
3. **Workerless completion**: CONSUMER job span closes the trace without an attempt
4. **Blocker visibility**: Span links show dependencies between chains
5. **Continuation tracking**: Span links connect jobs in a chain
6. **Retry visibility**: Multiple attempt spans under each job
7. **Deduplication tracking**: Attribute marks deduplicated chains, links to existing trace
8. **Cross-worker correlation**: Trace context stored in job state
9. **Optional integration**: Returns `undefined` when tracing disabled

See also:

- [ObservabilityAdapter](observability-adapter.md) - Interface design and methods
- [OTEL Metrics](otel-metrics.md) - OpenTelemetry metrics implementation
- [Job Chain Model](job-chain-model.md) - Chain identity and continuation model
- [Job Processing](job-processing.md) - Prepare/complete pattern
- [Deduplication](deduplication.md) - Chain-level deduplication options
- [Adapters](adapters.md) - Overall adapter design philosophy
- [Worker](worker.md) - Worker lifecycle and attempt handling
