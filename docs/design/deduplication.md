# Deduplication

## Overview

This document describes Queuert's deduplication strategy for preventing duplicate job execution.

## Chain-Level Deduplication

When starting a job chain, you can provide explicit deduplication options to prevent duplicate chains from being created:

```typescript
await queuert.startJobChain({
  typeName: "process",
  input: { userId: 123 },
  deduplication: {
    key: "user-123",
    scope: "incomplete",
    windowMs: 60000,
  },
});
```

### Options

- `key`: Unique identifier for deduplication matching. Chains with the same key are considered duplicates.
- `scope`:
  - `'incomplete'` (default): Deduplicates against incomplete jobs only. A new chain can be created once the previous one completes.
  - `'any'`: Deduplicates against any jobs including completed ones. Prevents any duplicate within the time window.
- `windowMs`: Optional time window in milliseconds. `undefined` means no time limit (deduplicate against all matching chains).

### Behavior

When a duplicate is detected:

- `startJobChain` returns the existing chain instead of creating a new one
- The returned chain has `deduplicated: true` to indicate it was not newly created
- The input from the new request is ignored; the existing chain's input is used

### Use Cases

**Idempotent API endpoints:**

```typescript
// POST /orders/:id/process
// Multiple requests for same order return same job chain
await queuert.startJobChain({
  typeName: "process-order",
  input: { orderId: req.params.id },
  deduplication: { key: `order-${req.params.id}`, scope: "incomplete" },
});
```

**Rate limiting background work:**

```typescript
// Only allow one sync per user per hour
await queuert.startJobChain({
  typeName: "sync-user-data",
  input: { userId },
  deduplication: { key: `sync-${userId}`, scope: "any", windowMs: 60 * 60 * 1000 },
});
```

## Continuation Restriction

Within a `complete` callback, `continueWith` can only be called once. Calling it multiple times throws an error:

```
"continueWith can only be called once"
```

### Rationale

This restriction ensures:

1. **Clear chain structure**: Each job has exactly one continuation, making the chain a simple linked list rather than a tree
2. **Predictable execution**: The next job in the chain is unambiguous
3. **Simple status tracking**: Chain completion is determined by following the single continuation path

### Pattern for Multiple Follow-up Jobs

If you need to trigger multiple follow-up jobs, use blockers instead. Note that deduplication isn't needed here since all jobs are created within a single transaction:

```typescript
defineJobTypes<{
  trigger: {
    entry: true;
    input: { ids: string[] };
    continueWith: { typeName: "aggregate" };
  };
  "process-item": {
    entry: true;
    input: { id: string };
    output: { result: number };
  };
  aggregate: {
    entry: true;
    input: { count: number };
    output: { total: number };
    blockers: [...{ typeName: "process-item" }[]];
  };
}>();

// Start trigger, which creates process-item blockers and continues to aggregate
const worker = await createQueuertInProcessWorker({
  stateAdapter,
  registry: jobTypes,
  log: createConsoleLog(),
  processors: {
    trigger: {
      attemptHandler: async ({ job, complete }) => {
        return complete(async ({ continueWith }) => {
          return continueWith({
            typeName: "aggregate",
            input: { count: job.input.ids.length },
            startBlockers: async () =>
              Promise.all(
                job.input.ids.map((id) =>
                  queuert.startJobChain({ typeName: "process-item", input: { id } }),
                ),
              ),
          });
        });
      },
    },
  },
});

await worker.start();
```

## Summary

Deduplication in Queuert:

1. **Chain-level**: Explicit keys prevent duplicate chains via `deduplication` option
2. **Continuation restriction**: Each job continues to exactly one next job
3. **Fan-out via blockers**: Multiple parallel jobs use the blocker pattern, not multiple continuations
