---
title: pg-boss
description: How Queuert relates to pg-boss — different tools for different shapes of background work.
sidebar:
  order: 1
---

[pg-boss](https://github.com/timgit/pg-boss) and Queuert both run background work and both store it in Postgres. They aren't the same kind of tool, and choosing between them is mostly a question of which kind you need.

> Compared versions: Queuert `0.12.0` and pg-boss `12.18.2`.

## What pg-boss is

pg-boss is a **Postgres-backed job queue**. The mental model is messages routed through named queues, with rich policies attached to each queue (singleton, exclusive, strict-FIFO, throttling), retries with backoff, cron schedules, dead-letter queues, and a supervisor that runs maintenance for you. Seven years of production use, polling-based, Postgres-only.

You install it, point it at Postgres, create queues, and `send` jobs to them. Workers poll those queues and run handlers.

## What Queuert is

Queuert is a **job-chain library** — durable, typed background work in your database. Job chains compose like Promise chains (`.then`, `Promise.all`), but they survive crashes and commit with your transactions.

The unit isn't a message on a queue — it's a typed **chain** of jobs of (potentially different) types, where each job's `continueWith` enqueues the next one in the same chain. Inputs, outputs, continuations, and blockers are inferred end-to-end via `defineJobTypes`. Chains start _inside_ your DB transactions, so the work that follows a write commits-or-rolls-back with the data that triggered it.

Queuert sits between job queues and workflow engines: a one-job chain _is_ a queue; a multi-step chain with blockers is closer to a workflow. Neither label fully fits — which is why the canonical term is "job-chain library."

## They aren't directly comparable

It's tempting to ask "does Queuert have a DLQ?" or "does pg-boss support transactional outbox?" and conclude one of them is missing features. That framing doesn't fit:

- **Queue concepts** like DLQs, queue policies, named lanes, and rate limits are central to pg-boss because pg-boss is a queue. They are absent from Queuert because Queuert isn't modeling messages-through-lanes — it's modeling chains tied to data.
- **Chain concepts** like typed continuations, blocker DAGs, and transactional enqueue are central to Queuert because Queuert is a job-chain library. They are absent from pg-boss because pg-boss isn't modeling chained execution — it's modeling queues.

The narrow overlap is "both let you defer work into the background and persist it in Postgres so it survives crashes." Beyond that, the shapes diverge.

## What pg-boss is good at

- **Queue semantics out of the box.** Six policies (`standard`, `short`, `singleton`, `stately`, `exclusive`, `key_strict_fifo`) enforced at the schema level via partial unique indexes. "At most one active per key," "strict FIFO per key with head-of-line blocking" — first-class, no application code.
- **Built-in cron scheduling.** `schedule(name, cron, data, { tz })` with timezone support, multiple schedules per queue.
- **Dead letter queues.** Set `deadLetter: 'dlq-name'` and final-failure jobs route there atomically.
- **Throttle / debounce primitives.** `sendThrottled` / `sendDebounced` with per-key time windows.
- **Built-in supervisor.** Cleanup, retention, and timeout detection run without you scheduling anything.
- **Maturity.** Seven years of deployment, widely used, well-documented.

These are what a _queue_ should be good at, and pg-boss invests heavily in them.

## What Queuert is good at

- **Chained execution of typed jobs.** A chain is a typed sequence: `"send-email"` continues with `"log-sent"` continues with `"update-user-status"`. Each step's input/output type is inferred from the previous step's `continueWith`. Renames are compiler-checked.
- **Fan-in via blockers.** "Wait for these N independent chains to finish, then run X" is a typed primitive backed by a `job_blocker` table — not glue code.
- **Transactional consistency, by design.** `startChain` enqueues inside your DB transaction; handler completion + next-step `continueWith` commit in the same transaction as your domain writes. For DB-bound work, no outbox at enqueue and no idempotency-key ritual at processing — both halves are structural, not application discipline.
- **Sub-second wakeup latency.** `LISTEN/NOTIFY` (or Redis pub/sub, or NATS) wakes workers when a row commits — no polling-interval floor.
- **Pluggable transports.** State (Postgres / SQLite / in-process) and notify (LISTEN/NOTIFY / Redis / NATS / polling) are independent.
- **Database as the system of record.** Chain state lives in the same DB as your domain data. No separate store, no separate consistency model.

These are what a _job-chain library_ should be good at, and Queuert is built around them.

## Differences worth knowing about

A few practical differences are worth calling out — not as scorecard rows, but as things you'd hit operationally:

- **Wakeup mechanism.** pg-boss polls every `pollingIntervalSeconds` (default 2s); that's the floor on enqueue→dequeue latency. Queuert listens on `LISTEN/NOTIFY` (or Redis / NATS), so workers wake when a row commits — typically tens of milliseconds.
- **Failure shape.** In pg-boss, final failure routes the job to a dead-letter queue (or its own `failed` set). In Queuert, failure stays as data on the chain (`last_attempt_error`); what happens next is an application decision. These are direct consequences of "queue" vs. "job-chain library."
- **Storage backends.** pg-boss is Postgres-only. Queuert works against Postgres or SQLite (experimental), or an in-process adapter for tests / single-process apps.

## Transactional consistency, both ends

Both pg-boss and Queuert store state in your Postgres, so the question isn't "is the state nearby?" — it's "is the API wired to commit your domain write atomically with the queue's state mutation?" pg-boss requires per-call discipline at one end and offers no equivalent at the other; Queuert is structural at both.

### Enqueue

pg-boss v12.17 (April 2026) added a `{ db }` option on `send` with bridge adapters for Knex / Kysely / Drizzle / Prisma to share the user's transaction:

```ts
await prisma.$transaction(async (tx) => {
  await prisma.user.create({ data: { ... } });
  await boss.send("welcome-email", { ... }, { db: fromPrisma(tx) });
});
```

It works, but it's per-call discipline: the adapter set is fixed (raw `pg` users have to write their own `IDatabase` shim), and most pg-boss code in the wild predates v12.17 and uses pg-boss's own pool — meaning dual-write is the default unless every call site remembers to pass `{ db }`.

Queuert's `startChain` writes into your DB transaction structurally — there is no enqueue path that bypasses it:

```ts
await withTransactionHooks(async (transactionHooks) =>
  db.transaction(async (tx) => {
    await tx.users.create({ ... });
    await client.startChain({
      tx,
      transactionHooks,
      typeName: "send-welcome-email",
      input: { ... },
    });
  }),
);
```

### Processing

This is where the gap is sharper. pg-boss's README markets *"Exactly-once job delivery"* — but that phrase refers specifically to `SKIP LOCKED` on the fetch path (two workers can't claim the same row atomically). It does NOT mean handler-to-completion is exactly-once. In [`src/manager.ts`](https://github.com/timgit/pg-boss/blob/master/src/manager.ts), the handler runs, returns, and pg-boss then calls `complete()` against its own pool in a separate transaction. If your handler commits domain writes and the worker crashes before `complete()` lands (or the lease expires via `expireInSeconds`, default 15 min), the job is re-fetched and the handler runs again — domain writes commit twice. The standard `work()` API has no hook to fuse "handler tx" with "pg-boss completion tx," so idempotency at processing is application discipline.

Queuert's complete callback runs inside the state adapter's transaction. Your handler's domain writes, the chain's completion, and the next step's `continueWith` all commit in one transaction:

```ts
"send-welcome-email": {
  attemptHandler: async ({ job, complete }) =>
    complete(async ({ sql, continueWith }) => {
      await sql`insert into email_log (user_id) values (${job.input.userId})`;
      return continueWith({ typeName: "log-sent", input: { ... } });
    }),
},
```

If the worker crashes before the transaction commits, *nothing* lands — neither the domain write nor the chain progression. The next attempt starts fresh. At-least-once delivery becomes effectively exactly-once for DB-bound work.

### What still needs care

The precondition is that your application DB is the system of record for the data your handlers touch. *External* side effects (the email actually being sent, a Stripe charge) still need idempotency keys — Queuert structurally fixes the DB half of at-least-once, not the network half. Cross-DB writes (handler writing to a separate microservice's database via API) still need an outbox at that boundary. For the chunk of your application where one Postgres is the source of truth, both outboxes go away.

## Choosing between them

The decision is mostly about which shape of tool fits your problem:

**Reach for pg-boss when:**

- Your problem is naturally queue-shaped: messages, lanes, routing, policies.
- You want first-class queue policies (singleton, exclusive, strict-FIFO) without building them yourself.
- You want cron, DLQ, and a maintenance supervisor in the box.
- Polling-interval wakeup latency is fine.
- You value seven years of production deployment over newer designs.

**Reach for Queuert when:**

- Your problem is naturally chain-shaped: typed multi-step sequences where this job continues with that job, possibly waiting on others.
- You want the work that follows a transaction to commit-or-rollback structurally with the data that triggered it.
- You want sub-second wakeup latency via `LISTEN/NOTIFY` (or Redis / NATS).
- Your DB is the system of record and you'd rather not introduce queue concepts you don't need.

If both shapes plausibly fit, the deciding question is usually whether transactional enqueue and typed chains matter more than queue policies, or the other way around. Neither is a feature the other side can add cheaply — they're consequences of what each tool fundamentally is.
