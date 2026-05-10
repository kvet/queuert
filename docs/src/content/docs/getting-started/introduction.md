---
title: Introduction
description: What Queuert is and why it exists.
sidebar:
  order: 1
---

## What is Queuert

Queuert is a **job-chain library** — durable, typed background work in your database. Job chains compose like Promise chains (`.then`, `Promise.all`), but they survive crashes and commit with your transactions.

The unit of work is a typed **chain** of jobs of (potentially different) types. Each step's input, output, and continuation are inferred end-to-end via `defineJobTypes`. Chains start _inside_ your DB transactions, so the work that follows a write commits-or-rolls-back with the data that triggered it.

Queuert sits between job queues and workflow engines. A one-job chain _is_ a queue. A multi-step chain with blockers is closer to a workflow. Neither label fully fits — which is why the canonical term is "job-chain library."

## A look at the API

Define a typed chain. Each step declares its input, output, and which type it continues with.

```ts
const jobTypes = defineJobTypes<{
  "provision-account": {
    entry: true;
    input: { userId: number };
    continueWith: { typeName: "send-welcome-email" };
  };
  "send-welcome-email": {
    input: { userId: number; accountId: string };
    continueWith: { typeName: "sync-to-crm" };
  };
  "sync-to-crm": {
    input: { userId: number; accountId: string };
  };
}>();
```

Start the chain _inside_ your application's DB transaction. If the transaction rolls back (because, say, user creation fails a constraint check), the chain is never created. There's no separate queue to keep in sync — your DB transaction is the boundary. (See [transactional outbox pattern](https://microservices.io/patterns/data/transactional-outbox.html).)

```ts
const client = await createClient({ stateAdapter, jobTypes });

await withTransactionHooks(async (transactionHooks) =>
  db.transaction(async (tx) => {
    const user = await tx.users.create({ name: "Alice", email: "alice@example.com" });

    await client.startChain({
      tx,
      transactionHooks,
      typeName: "provision-account",
      input: { userId: user.id },
      //         ↑ wrong shape here is a compile error
    });
  }),
);
```

A worker picks up each step and continues to the next. The compiler enforces that `continueWith` matches the declared next type's input.

```ts
const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "provision-account": {
        attemptHandler: async ({ job, complete }) => {
          const accountId = await provisionAccount(job.input.userId);

          return complete(async ({ continueWith }) =>
            continueWith({
              typeName: "send-welcome-email",
              input: { userId: job.input.userId, accountId },
              //      ↑ missing accountId would be a compile error
            }),
          );
        },
      },
      // ...handlers for "send-welcome-email" and "sync-to-crm"
    },
  }),
});

const stop = await worker.start();
```

## Where it fits

Background-work libraries split across two axes: the _shape_ of work they model and where the _state_ lives.

- **Job queues** (BullMQ, pg-boss) model messages routed through named lanes with policies. Good fit for "I have many independent jobs to run."
- **Workflow platforms** (Temporal, Inngest) model long-lived processes with rich runtime interaction (signals, queries, durable sleeps). Good fit for "I have multi-step processes that run for hours/days/weeks and need to survive arbitrary failures."
- **Queuert** is a third thing: a job-chain library. Chains can be a single job (queue-shaped) or a multi-step typed sequence with fan-in (workflow-shaped) — both are first-class. Good fit for "I have background work that should commit with my domain writes and finish in seconds-to-minutes."

For one-on-one comparisons see the [comparison docs](/queuert/comparison/).

## Why pick Queuert

- **Transactional, both ends.** Enqueue commits inside your DB transaction; handler completion + next-step `continueWith` commit in the same transaction as your domain writes. For DB-bound work, no outbox at enqueue and no idempotency-key ritual at processing — both halves are structural.
- **Typed job chains.** Inputs, outputs, continuations, and blockers infer end-to-end via `defineJobTypes`. Renames and refactors are compiler-checked.
- **Lives in your database.** Postgres or SQLite. No Redis required, no workflow server, no separate persistence tier to operate.
- **Sub-second wakeup latency.** `LISTEN/NOTIFY` (or Redis pub/sub, or NATS) wakes workers when a row commits — not on a polling timer.
- **Fan-in via blockers.** "Wait for these N independent chains to finish, then run X" is a typed primitive backed by a `job_blocker` table.
- **Schedule for later.** Delay a chain to a specific time or duration. Schedule retries with backoff. Future work, no extra infrastructure.
- **Deduplication.** Pass a deduplication key on enqueue. Identical keys collapse to a single chain — at-most-once, by construction.
- **MIT licensed.** No enterprise tier, no vendor lock-in.
