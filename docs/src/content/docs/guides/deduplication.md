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
