# Worker Design

## Overview

This document describes the worker design in Queuert: how workers coordinate job processing, manage concurrency, and handle failures.

A **worker** runs a main loop that coordinates job processing across multiple **slots**. Each slot processes one job at a time; the worker manages concurrency and scaling.

## Concurrency Model

Workers process jobs in parallel using slots. Configure concurrency via the `concurrency` option:

```typescript
concurrency: 10;
```

Default: single slot (`concurrency: 1`).

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

1. Main loop spawns slots up to `concurrency`
2. Each slot acquires a job and processes it independently
3. When a slot completes, main loop spawns a replacement
4. Slots compete for jobs via database-level locking (`FOR UPDATE SKIP LOCKED` in PostgreSQL)

## Worker Lifecycle

### Main Loop

The worker runs a single coordinating loop:

1. **Reap**: Reclaim one expired lease (if any)
2. **Fill**: Spawn slots up to `concurrency`
3. **Wait**: Listen for notification, poll timeout, or slot completion
4. **Repeat**

### Shutdown

Calling `stop()` triggers graceful shutdown:

1. Signal abort controller
2. Stop spawning new slots
3. Wait for all in-flight jobs to complete (or abandon via lease expiry)
4. Emit `workerStopping` and `workerStopped` observability events

## Worker Identity

Each worker has a unique identity stored in `leasedBy`. The worker tracks active jobs internally and routes abort signals by job ID—no per-slot identity is needed.

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

A single worker can handle multiple job types. Slots poll all registered types and process whichever is available first. Per-type configuration (lease, retry) overrides worker defaults.

### Attempt Middlewares

Workers support middlewares that wrap each job attempt, enabling cross-cutting concerns like contextual logging with `AsyncLocalStorage`. Middlewares compose in order: first middleware's "before" runs first, last middleware's "after" runs first.

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
