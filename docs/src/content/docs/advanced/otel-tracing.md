---
title: OTEL Tracing
description: OpenTelemetry span hierarchy and messaging conventions.
sidebar:
  order: 13
---

## Overview

This document describes Queuert's OpenTelemetry tracing implementation. Tracing provides end-to-end visibility into chain execution, including job dependencies, retry attempts, and blocker relationships.

## Span Hierarchy

Queuert uses a five-level span hierarchy:

```
PRODUCER: create chain.{type}          ← Chain published (ends immediately)
│
├── PRODUCER: create job.{type}        ← Job published (ends immediately)
│   │
│   ├── PRODUCER: await chain.{type}    ← Blocker dependency
│   │       links: [blocker chain]
│   │   └── CONSUMER: resolve chain.{type}  ← Blocker resolved
│   │
│   ├── CONSUMER: start job-attempt.{type}    ← Worker processes attempt (has duration)
│   │   ├── INTERNAL: prepare
│   │   └── INTERNAL: complete
│   │
│   └── CONSUMER: start job-attempt.{type}    ← Retry attempt
│       ├── INTERNAL: prepare
│       └── INTERNAL: complete
│
├── PRODUCER: create job.{type}        ← Continuation job
│   │
│   └── CONSUMER: start job-attempt.{type} (final)
│       ├── INTERNAL: prepare
│       ├── INTERNAL: complete
│       └── CONSUMER: complete chain.{type}  ← Chain completion
```

Span kinds use OpenTelemetry's PRODUCER/CONSUMER/INTERNAL semantics. The chain has both a PRODUCER (creation) and CONSUMER (completion) span for symmetry.

| Span                         | Kind     | Created                          | Ended                   | Duration         |
| ---------------------------- | -------- | -------------------------------- | ----------------------- | ---------------- |
| **create chain.{type}**      | PRODUCER | `startChain()`                   | Immediately             | ~0ms             |
| **create job.{type}**        | PRODUCER | `startChain()`, `continueWith()` | Immediately             | ~0ms             |
| **await chain.{type}**       | PRODUCER | `startChain()` with blockers     | Immediately             | ~0ms             |
| **resolve chain.{type}**     | CONSUMER | Blocker chain completes          | Immediately             | ~0ms             |
| **start job-attempt.{type}** | CONSUMER | Worker claims job                | Attempt completes/fails | Processing time  |
| **prepare**                  | INTERNAL | `prepare()` called               | `prepare()` returns     | Transaction time |
| **complete**                 | INTERNAL | `complete()` called              | `complete()` returns    | Transaction time |
| **complete job.{type}**      | CONSUMER | Workerless completion            | Immediately             | ~0ms             |
| **complete chain.{type}**    | CONSUMER | Final job completes              | Immediately             | ~0ms             |

## Blocker Relationships

When a job has blockers (dependencies on other chains), each blocker gets a PRODUCER/CONSUMER span pair as a child of the blocked job's PRODUCER span. The PRODUCER (`await chain.{type}`) is created at `startChain` time with a link to the blocker chain. The CONSUMER (`resolve chain.{type}`) is created when the blocker chain completes, so the time between them represents the blocking duration.

The blocker PRODUCER span's trace context is persisted in the `job_blocker` table so the CONSUMER can be created later by a different process (the one completing the blocker chain).

```
EXTERNAL span (e.g., HTTP request)
│
├── PRODUCER: create chain.process-order ──────────────
│   │
│   └── PRODUCER: create job.process-order
│       │
│       ├── PRODUCER: await chain.fetch-user ──link──→ chain fetch-user
│       │   └── CONSUMER: resolve chain.fetch-user
│       │
│       ├── PRODUCER: await chain.fetch-inventory ──link──→ chain fetch-inventory
│       │   └── CONSUMER: resolve chain.fetch-inventory
│       │
│       └── CONSUMER: start job-attempt.process-order
│           │   job.blockers contains resolved blocker outputs
│           ├── INTERNAL: prepare
│           ├── INTERNAL: complete ✓
│           └── CONSUMER: complete chain.process-order
│
├── PRODUCER: create chain.fetch-user ─────────────────
│   │
│   └── PRODUCER: create job.fetch-user
│       │
│       └── CONSUMER: start job-attempt.fetch-user ✓
│           ├── INTERNAL: prepare
│           ├── INTERNAL: complete
│           └── CONSUMER: complete chain.fetch-user
│
└── PRODUCER: create chain.fetch-inventory ────────────
    │
    └── PRODUCER: create job.fetch-inventory
        │
        └── CONSUMER: start job-attempt.fetch-inventory ✓
            ├── INTERNAL: prepare
            ├── INTERNAL: complete
            └── CONSUMER: complete chain.fetch-inventory
```

### Blocker Span Lifecycle

1. **PRODUCER created and ended** in `startChain` when the job has blockers — one PRODUCER span per blocker, as a child of the job's PRODUCER span, with a link to the blocker chain's trace context
2. **Persisted** — the PRODUCER span context is stored in the `job_blocker` table (`trace_context` column) so the CONSUMER can be created by another process
3. **CONSUMER created** when `unblockJobs` detects the blocker chain has completed — the PRODUCER span context is read from `job_blocker` and a CONSUMER span is created as its child

## Continuation Relationships

When a job continues to another job via `continueWith`, the continuation links to its origin:

```
PRODUCER: create chain.multi-step ────────────────────────
│
├── PRODUCER: create job.step-one
│   └── CONSUMER: start job-attempt.step-one #1
│       ├── INTERNAL: prepare
│       └── INTERNAL: complete (calls continueWith)
│
└── PRODUCER: create job.step-two
    │   links: [job step-one]  ← origin link
    │
    └── CONSUMER: start job-attempt.step-two #1 (final)
        ├── INTERNAL: prepare
        ├── INTERNAL: complete
        └── CONSUMER: complete chain.multi-step
```

The origin link shows the causal flow: "step-two was created by step-one's completion".

## Workerless Completion

When a job is completed via `completeChain` (without a worker), there is no job-attempt. Instead, a CONSUMER job span marks the completion, and if the chain is fully completed, a CONSUMER chain span closes the trace:

```
PRODUCER: create chain.approve-order ─────────────────────
│
└── PRODUCER: create job.approve-order
    │
    └── CONSUMER: complete job.approve-order  ← Workerless completion
        │
        └── CONSUMER: complete chain.approve-order
```

The CONSUMER job span is a child of the PRODUCER job span and carries the same chain/job attributes. When `continueWith` is called during workerless completion, the CONSUMER chain span is omitted (the chain continues):

```
PRODUCER: create chain.multi-step ────────────────────────
│
├── PRODUCER: create job.step-one
│   │
│   └── CONSUMER: complete job.step-one  ← Workerless completion (continueWith)
│
└── PRODUCER: create job.step-two
    │   links: [job step-one]
    │
    └── ...
```

This uses the `completeJobSpan` adapter method rather than `startAttemptSpan`, reflecting that no attempt processing occurred.

## Chain Duration Measurement

With `create chain` at start and `complete chain` at end, total chain duration is calculated as:

```
Chain Duration = complete chain.startTime - create chain.startTime
```

This provides end-to-end visibility even though individual PRODUCER/CONSUMER spans are instantaneous markers.

## Deduplication

When `startChain` is called with deduplication options and a matching chain already exists, no new chain is created. The span must reflect this outcome correctly.

Deduplication is **not an error**—it's expected behavior that successfully returned an existing chain. Per [OpenTelemetry status conventions](https://opentelemetry.io/docs/specs/otel/trace/api/#set-status), the span status should remain `UNSET` (not `ERROR`), with an attribute indicating deduplication occurred.

When deduplication occurs:

1. Adds attribute `queuert.chain.deduplicated: true`
2. References the existing chain's IDs
3. Optionally links to the existing chain's trace context

```
Caller requests startChain with deduplication key "user-123":

First call (creates new chain):
PRODUCER create chain.process-user [0ms] ──────────────
│   queuert.chain.id: "abc-123"
│   queuert.chain.deduplicated: false
│
└── ... (normal processing)

Second call (deduplicated):
PRODUCER create chain.process-user [0ms] ──────────────
    queuert.chain.id: "abc-123"  ← same as existing
    queuert.chain.deduplicated: true
    links: [chain abc-123]  ← link to existing chain
```

## Span Attributes

### Chain Attributes

| Attribute                    | Type    | Description                        |
| ---------------------------- | ------- | ---------------------------------- |
| `queuert.chain.id`           | string  | Chain ID                           |
| `queuert.chain.type`         | string  | Chain type name                    |
| `queuert.chain.deduplicated` | boolean | `true` when chain was deduplicated |

### Job Attributes

| Attribute             | Type   | Description                       |
| --------------------- | ------ | --------------------------------- |
| `queuert.job.id`      | string | Job ID                            |
| `queuert.job.type`    | string | Job type name                     |
| `queuert.job.attempt` | number | Attempt number (on attempt spans) |

### Worker Attributes

| Attribute           | Type   | Description                      |
| ------------------- | ------ | -------------------------------- |
| `queuert.worker.id` | string | Worker ID processing the attempt |

### Attempt Result Attributes

| Attribute                      | Type   | Description                                   |
| ------------------------------ | ------ | --------------------------------------------- |
| `queuert.attempt.result`       | string | `"completed"` or `"failed"`                   |
| `queuert.rescheduled_at`       | string | ISO 8601 timestamp of next retry (on failure) |
| `queuert.rescheduled_after_ms` | number | Delay in ms before next retry (on failure)    |

### Continuation Attributes

| Attribute                         | Type   | Description                       |
| --------------------------------- | ------ | --------------------------------- |
| `queuert.continued_with.job_id`   | string | ID of the continuation job        |
| `queuert.continued_with.job_type` | string | Type name of the continuation job |

### Blocker Attributes

| Attribute                    | Type   | Description                                |
| ---------------------------- | ------ | ------------------------------------------ |
| `queuert.blocker.chain.id`   | string | Blocker chain ID                           |
| `queuert.blocker.chain.type` | string | Blocker chain type name                    |
| `queuert.blocker.index`      | number | Index of the blocker in the blockers array |

## See Also

- [OTEL Metrics](../otel-metrics/) — Counters, histograms, and gauges
- [OTEL Internals](../otel-internals/) — Adapter architecture, W3C context propagation, and transactional buffering
- [Chain Model](../chain-model/) — Chain identity and continuation model
- [Job Processing](../job-processing/) — Prepare/complete pattern
- [Adapters](../adapters/) — Overall adapter design philosophy
- [In-Process Worker](../in-process-worker/) — Worker lifecycle and attempt handling
