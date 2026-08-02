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

call1: "createChain\nkey: 'sync:123'" { class: client; width: 180; height: 70 }
call2: "createChain\nkey: 'sync:123'" { class: client; width: 180; height: 70 }
call3: "createChain\nkey: 'sync:123'" { class: client; width: 180; height: 70 }

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
  client.createChain({
    transactionHooks,
    typeName: "sync-user",
    input: { userId: "123" },
    deduplication: { key: "sync:user:123", scope: "running" },
  }),
);

// Second call with same key returns existing chain
const chain2 = await withTransactionHooks(async (transactionHooks) =>
  client.createChain({
    transactionHooks,
    typeName: "sync-user",
    input: { userId: "123" },
    deduplication: { key: "sync:user:123", scope: "running" },
  }),
);

chain2.deduplicated; // true — returned existing chain
chain2.id === chain1.id; // true
```

## Deduplication Modes

The `scope` option controls what jobs to check for duplicates:

- **`running`** -- Only dedup against running chains (allows new chain after previous completes)
- **`any`** -- Dedup against any existing chain with this key

```ts
// Only one active health check at a time, but can start new after completion
await withTransactionHooks(async (transactionHooks) =>
  client.createChain({
    transactionHooks,
    typeName: "health-check",
    input: { serviceId: "api-server" },
    deduplication: {
      key: "health:api-server",
      scope: "running",
    },
  }),
);
```

## Time-Windowed Deduplication

Use `windowMs` to rate-limit job creation. Duplicates are prevented only within the time window.

```ts
// No duplicate syncs within 1 hour
await withTransactionHooks(async (transactionHooks) =>
  client.createChain({
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

Use `excludeChainIds` to skip specific chains during deduplication matching. This is essential for recurring jobs that self-schedule within a completion callback — the current chain is still incomplete at that point, so without exclusion the new chain would be deduplicated against it.

```ts
// Inside a processor's completion callback
return complete(async ({ sql, transactionHooks }) => {
  await client.createChain({
    sql,
    transactionHooks,
    typeName: "health-check",
    input: { serviceId: job.input.serviceId },
    schedule: { afterMs: 5 * 60 * 1000 },
    deduplication: {
      key: `health:${job.input.serviceId}`,
      scope: "running",
      excludeChainIds: [job.chainId],
    },
  });
  return { checkedAt: new Date().toISOString() };
});
```

## Reading a chain back by its key

A key you own is also a lookup handle. `getChain` and `getChains` accept the same deduplication options `createChain` does, and resolve **the single chain a `createChain` with those options would collapse onto** — the newest match in scope — without creating anything. Code that kept the key but not the generated id can still find its chain, and the result is `undefined` exactly when that create would have started a fresh chain instead.

```ts
// The alive chain for this key, or undefined if none is running
const alive = await client.getChain({
  typeName: "health-check",
  deduplication: { key: `health:${serviceId}`, scope: "running" },
});

// Batch form — positional array, one resolved chain per entry
const chains = await client.getChains({
  typeName: "health-check",
  deduplications: [
    { key: "health:api-server", scope: "running" },
    { key: "health:worker", scope: "any" },
  ],
});
```

`typeName` is **required** on these forms and participates in the lookup, unlike the id-based reads where it merely asserts the resolved chain's type. A key identifies a chain only within its chain type — deduplication never collapses across types — so there is no match to resolve without it.

Every entry carries its own options, and they mean exactly what they mean on `createChain`: `scope: "running"` sees only alive chains and resolves the newest of them, `scope: "any"` also sees completed ones and resolves to the latest occurrence, and `windowMs` / `excludeChainIds` narrow the match the same way.

These reads compose with `lock: true` — resolving the alive chain for a key and locking it in one step is the primitive behind keyed-singleton schedulers. Note that a lock only covers rows that exist, so it does not serialize a "create if absent" against a concurrent create; that race is closed by `createChain` deduplication itself. See [Locked reads](../queries/#locked-reads).

See [examples/showcase-scheduling](https://github.com/kvet/queuert/tree/main/examples/showcase-scheduling) for a complete working example demonstrating deduplication with recurring jobs. See also [Job & Chain Queries](../queries/), [Scheduling](../scheduling/), and [Transaction Hooks](../transaction-hooks/).
