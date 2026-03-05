---
title: Deduplication
description: Prevent duplicate job chains with deduplication keys.
sidebar:
  order: 10
---

Deduplication prevents duplicate job chains from being created. When you start a job chain with a deduplication key, Queuert checks if a chain with that key already exists and returns the existing chain instead of creating a new one.

```ts
// First call creates the chain
const chain1 = await withTransactionHooks(async (transactionHooks) =>
  client.startJobChain({
    transactionHooks,
    typeName: "sync-user",
    input: { userId: "123" },
    deduplication: { key: "sync:user:123" },
  }),
);

// Second call with same key returns existing chain
const chain2 = await withTransactionHooks(async (transactionHooks) =>
  client.startJobChain({
    transactionHooks,
    typeName: "sync-user",
    input: { userId: "123" },
    deduplication: { key: "sync:user:123" },
  }),
);

chain2.deduplicated; // true — returned existing chain
chain2.id === chain1.id; // true
```

## Deduplication Modes

The `scope` option controls what jobs to check for duplicates:

- **`incomplete`** (default) -- Only dedup against incomplete chains (allows new chain after previous completes)
- **`any`** -- Dedup against any existing chain with this key

```ts
// Only one active health check at a time, but can start new after completion
await withTransactionHooks(async (transactionHooks) =>
  client.startJobChain({
    transactionHooks,
    typeName: "health-check",
    input: { serviceId: "api-server" },
    deduplication: {
      key: "health:api-server",
      scope: "incomplete",
    },
  }),
);
```

## Time-Windowed Deduplication

Use `windowMs` to rate-limit job creation. Duplicates are prevented only within the time window.

```ts
// No duplicate syncs within 1 hour
await withTransactionHooks(async (transactionHooks) =>
  client.startJobChain({
    transactionHooks,
    typeName: "sync-data",
    input: { sourceId: "db-primary" },
    deduplication: {
      key: "sync:db-primary",
      scope: "any",
      windowMs: 60 * 60 * 1000, // 1 hour
    },
  }),
);
```

See [examples/showcase-scheduling](https://github.com/kvet/queuert/tree/main/examples/showcase-scheduling) for a complete working example demonstrating deduplication with recurring jobs. See also [Scheduling](../scheduling/) and [Transaction Hooks](../transaction-hooks/).

## How It Works

Queuert implements deduplication at two levels: chain-level and continuation-level.

### Chain-Level Deduplication

When `startJobChain` is called with a `deduplication` option, the state adapter checks for an existing chain matching the key, scope, and time window before inserting. If a match is found, the existing chain is returned with `deduplicated: true` and the new input is ignored. The `deduplication_key` column is reserved exclusively for root-level dedup -- continuation jobs never use it.

### Continuation Deduplication

Each job in a chain has a `chain_index` that provides deterministic ordering (root = 0, first continuation = 1, etc.). The caller computes the index as `currentJob.chainIndex + 1` when creating a continuation. A UNIQUE constraint on `(chain_id, chain_index)` ensures that if the same continuation is created twice (e.g., due to a retry), the second attempt detects the existing job at the same index instead of creating a duplicate.

### The `continueWith` Restriction

Within a `complete` callback, `continueWith` can only be called once. This ensures each job has exactly one continuation, making the chain a simple linked list rather than a tree. The next job in the chain is always unambiguous, and chain completion is determined by following the single continuation path. For multiple parallel follow-up jobs, use the blocker pattern instead of multiple continuations.
