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

## Self-Scheduling Recurring Chains

A recurring chain schedules its next occurrence from its own terminal job. Under `scope: "running"` the ordering matters: commit **first**, then create the next chain. `finish({ output: ... })` commits the completion inside the complete transaction, so by the time `createChain` runs, the chain being finished already reads as completed and cannot match itself.

```ts
// Inside a processor's complete callback
return complete(async ({ finish, sql, transactionHooks }) => {
  const completedJob = await finish({ output: { checkedAt: new Date().toISOString() } });

  await client.createChain({
    sql,
    transactionHooks,
    typeName: "health-check",
    input: { serviceId: job.input.serviceId },
    schedule: { afterMs: 5 * 60 * 1000 },
    deduplication: {
      key: `health:${job.input.serviceId}`,
      scope: "running",
    },
  });

  return completedJob;
});
```

Scheduling _before_ committing instead matches the still-running chain and silently suppresses the next occurrence, ending the recurrence. The same applies to scheduling from a mid-chain job: that chain is genuinely still running, so schedule from the terminal job instead.

See [examples/showcase-scheduling](https://github.com/kvet/queuert/tree/main/examples/showcase-scheduling) for a complete working example demonstrating deduplication with recurring jobs. See also [Scheduling](../scheduling/) and [Transaction Hooks](../transaction-hooks/).
