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

## Continuation Deduplication

When a job calls `continueWith`, the continuation job is created with an internal deduplication key of `continued:${job.id}`. This ensures that if the same continuation is created twice (e.g., due to a retry after a crash), the second attempt returns the existing job instead of creating a duplicate.

The continuation dedup key is scoped to the chain (`chain_id`) and only matches non-root jobs (`id != chain_id`), so it cannot collide with user-provided chain-level deduplication keys which only apply to root jobs.

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

For multiple parallel follow-up jobs, use the blocker pattern instead of multiple continuations.

## Summary

Deduplication in Queuert:

1. **Chain-level**: Explicit keys prevent duplicate chains via `deduplication` option
2. **Continuation restriction**: Each job continues to exactly one next job
3. **Fan-out via blockers**: Multiple parallel jobs use the blocker pattern, not multiple continuations
