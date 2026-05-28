---
title: Deduplication
description: Prevent duplicate chains with deduplication keys.
sidebar:
  order: 10
---

Deduplication prevents duplicate chains from being created. When you start a chain with a deduplication key, Queuert checks if a chain with that key already exists and returns the existing chain instead of creating a new one.

```d2
...@../_classes.d2

direction: right

call1: "startChain\nkey: 'sync:123'" { class: client; width: 180; height: 70 }
call2: "startChain\nkey: 'sync:123'" { class: client; width: 180; height: 70 }
call3: "startChain\nkey: 'sync:123'" { class: client; width: 180; height: 70 }

chain: "chain abc-123\n(existing)" { class: job-accent; width: 180; height: 70 }

new:  "deduplicated: false\nnew chain"     { class: job-done;  width: 180; height: 60 }
dup1: "deduplicated: true\nreturns abc-123" { class: job-muted; width: 200; height: 60 }
dup2: "deduplicated: true\nreturns abc-123" { class: job-muted; width: 200; height: 60 }

call1 -> chain: "creates" { class: flow-green }
call2 -> chain: "match"   { class: dotted }
call3 -> chain: "match"   { class: dotted }
chain -> new
chain -> dup1
chain -> dup2
```

```ts
// First call creates the chain
const chain1 = await withTransactionHooks(async (transactionHooks) =>
  client.startChain({
    transactionHooks,
    typeName: "sync-user",
    input: { userId: "123" },
    deduplication: { key: "sync:user:123" },
  }),
);

// Second call with same key returns existing chain
const chain2 = await withTransactionHooks(async (transactionHooks) =>
  client.startChain({
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

- **`open`** (default) -- Only dedup against open (not-yet-closed) chains (allows a new chain after the previous one closes)
- **`any`** -- Dedup against any existing chain with this key

```ts
// Only one active health check at a time, but can start new after completion
await withTransactionHooks(async (transactionHooks) =>
  client.startChain({
    transactionHooks,
    typeName: "health-check",
    input: { serviceId: "api-server" },
    deduplication: {
      key: "health:api-server",
      scope: "open",
    },
  }),
);
```

## Time-Windowed Deduplication

Use `windowMs` to rate-limit job creation. Duplicates are prevented only within the time window.

```ts
// No duplicate syncs within 1 hour
await withTransactionHooks(async (transactionHooks) =>
  client.startChain({
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

## Excluding Chains

Use `excludeChainIds` to skip specific chains during deduplication matching. This is essential for recurring jobs that self-schedule within a completion callback — the current chain is still open at that point, so without exclusion the new chain would be deduplicated against it.

```ts
// Inside a processor's completion callback
return complete(async ({ sql, transactionHooks }) => {
  await client.startChain({
    sql,
    transactionHooks,
    typeName: "health-check",
    input: { serviceId: job.input.serviceId },
    schedule: { afterMs: 5 * 60 * 1000 },
    deduplication: {
      key: `health:${job.input.serviceId}`,
      excludeChainIds: [job.chainId],
    },
  });
  return { checkedAt: new Date().toISOString() };
});
```

See [examples/showcase-scheduling](https://github.com/kvet/queuert/tree/main/examples/showcase-scheduling) for a complete working example demonstrating deduplication with recurring jobs. See also [Scheduling](../scheduling/) and [Transaction Hooks](../transaction-hooks/).
