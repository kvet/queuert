# Job Chain Model Design

## Overview

This document describes Queuert's unified job model and the Promise-inspired chain abstraction.

## Core Concepts

### Job

A **Job** is an individual unit of work with a lifecycle:

```
blocked/pending → running → completed
```

Each job:

- Belongs to a **Job Type** that defines its input/output schema
- Contains typed input data and (when completed) output data
- Can `continueWith` to create a linked follow-up job
- Can depend on **blockers** (other chains that must complete first)

### Job Chain

A **Job Chain** is a series of linked jobs where each job can continue to the next—just like a JavaScript Promise chain.

```
Job A → Job B → Job C → (completed)
```

The chain completes when its final job completes without continuing.

## The Promise Analogy

The design directly mirrors JavaScript Promises:

```javascript
// JavaScript: A Promise chain IS the first promise
const chain = fetch(url)           // chain === this promise
  .then(processResponse)           // continuation
  .then(formatResult);             // continuation

// Queuert: A Job Chain IS its first job
const chain = startJobChain(...)   // chain.id === firstJob.id
  .continueWith(processStep)       // continuation
  .continueWith(formatStep);       // continuation
```

Key parallel:

- A Promise chain doesn't have a separate "chain ID"—the original promise IS the chain's identity
- A Job Chain doesn't have a separate entity—the first job IS the chain's identity

This is the fundamental insight: **the first job IS the chain**.

### Why Promises?

JavaScript developers already understand Promise chains intuitively:

```javascript
// This is one chain, not three separate things
fetchUser(id)
  .then(user => fetchOrders(user.id))
  .then(orders => processOrders(orders));
```

The chain:

- Has identity (the first promise)
- Has continuations (`.then()` callbacks)
- Completes when the last `.then()` resolves
- Can branch, loop, or terminate early

Job Chains work identically, but persist across process restarts and distribute across workers.

## Identity Model

For the first job in a chain: `job.id === job.chainId`

This isn't redundant—it's a meaningful signal that identifies the chain starter. Continuation jobs have `job.id !== job.chainId` but share the same `chainId` as all other jobs in the chain.

```
┌─────────────────────────────────────────────────────────────┐
│ Chain (id: "abc-123")                                       │
├─────────────────────────────────────────────────────────────┤
│  Job A              Job B              Job C                │
│  id: "abc-123"  →   id: "def-456"  →   id: "ghi-789"       │
│  chainId: "abc-123" chainId: "abc-123" chainId: "abc-123"  │
│  ↑                                                          │
│  First job IS the chain                                     │
└─────────────────────────────────────────────────────────────┘
```

## Unified Model Benefits

Having the first job BE the chain (rather than a separate entity) provides:

### Simplicity

- One table, one type, one set of operations
- No separate `job_chain` table to manage
- No joins, no synchronization issues

### Flexibility

The first job can be:

- A lightweight "alias" that immediately continues to real work
- A full job that processes and completes the chain in one step
- Anything in between

### Performance

- `chainTypeName` denormalized on every job for O(1) filtering
- No subqueries needed to find chains by type
- Efficient at scale (millions of jobs)

## Execution Patterns

Chains support various patterns via `continueWith`:

### Linear

```
A → B → C → done
```

### Branched

```
A → B1 (if condition)
  → B2 (else)
```

### Loop

```
A → A → A → done
```

### Go-to (jump back)

```
A → B → A → B → done
```

## Blockers: Chain Dependencies

Chains can depend on other chains to complete before starting:

```
┌──────────────┐
│ Blocker A    │───┐
└──────────────┘   │
                   ├──→ Main Chain (blocked until A and B complete)
┌──────────────┐   │
│ Blocker B    │───┘
└──────────────┘
```

Blockers are declared at the type level and provided via `startBlockers` callback. The main job starts as `blocked` and transitions to `pending` when all blockers complete.

## API Design

The API mirrors the Promise mental model:

```typescript
// Start a chain (like creating a Promise)
const chain = await queuert.startJobChain({
  typeName: "process-image",
  input: { imageId: "123" },
});

// Continue in a worker (like .then())
return complete(({ continueWith }) =>
  continueWith({
    typeName: "distribute-image",
    input: { imageId, processedUrl },
  })
);

// Wait for completion (like await)
await queuert.waitForJobChainCompletion(chain.id);
```

## Summary

The Job Chain model:

1. **Mirrors Promises**: Familiar mental model for JavaScript developers
2. **Unified identity**: The first job IS the chain—no separate entity
3. **Single table**: Jobs and chains share storage; `chainId` links them
4. **Flexible patterns**: Linear, branched, looped, or jumping execution
5. **Distributed**: Unlike Promises, chains persist and distribute across workers
