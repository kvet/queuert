---
title: Introduction
description: What Queuert is and why it exists.
sidebar:
  order: 1
---

## Sorry, what?

Imagine a user signs up and you want to send them a welcome email. You don't want to block the registration request, so you queue it as a background job.

```ts
const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

const client = await createClient({
  stateAdapter,
  registry: jobTypes,
});

await withTransactionHooks(async (transactionHooks) =>
  db.transaction(async (tx) => {
    const user = await tx.users.create({
      name: "Alice",
      email: "alice@example.com",
    });

    await client.startJobChain({
      tx,
      transactionHooks,
      typeName: "send-welcome-email",
      input: { userId: user.id, email: user.email, name: user.name },
    });
  }),
);
```

We scheduled the job inside a database transaction. This ensures that if the transaction rolls back (e.g., user creation fails), the job is not started. No orphaned emails. (See [transactional outbox pattern](https://microservices.io/patterns/data/transactional-outbox.html).)

Later, a background worker picks up the job and sends the email:

```ts
const worker = await createInProcessWorker({
  client,
  processors: {
    "send-welcome-email": {
      attemptHandler: async ({ job, complete }) => {
        await sendEmail({
          to: job.input.email,
          subject: "Welcome!",
          body: `Hello ${job.input.name}, welcome to our platform!`,
        });

        return complete(async () => ({
          sentAt: new Date().toISOString(),
        }));
      },
    },
  },
});

const stop = await worker.start();
```

## It looks familiar, right?

This library is inspired by workflow engines like [Temporal](https://temporal.io/) and queue systems like [BullMQ](https://docs.bullmq.io/).

These tools are powerful, but they come with trade-offs:

- **Separate infrastructure** — Most queue systems require dedicated infrastructure (Redis, a workflow server, or a separate database) in addition to your application database. That's another system to deploy, monitor, and maintain.
- **Dual-write consistency** — Writing to your database and a separate queue in two steps risks inconsistency. If one operation fails, you end up with orphaned data or orphaned jobs.
- **Vendor lock-in** — When workflow state lives outside your database, migrating away means re-architecting your application.
- **Complexity** — Workflow engines often require deterministic code, have execution limits, and introduce concepts that can be overkill for many background job use cases.
- **Licensing & maintenance** — Some popular libraries have enterprise licensing requirements or have slowed in maintenance.

## Why Queuert?

- **Your database is the source of truth** — No separate persistence layer. Jobs live alongside your application data.
- **True transactional consistency** — Start jobs inside your database transactions. If the transaction rolls back, the job is never created. No dual-write problems.
- **No vendor lock-in** — Works with PostgreSQL and SQLite. Bring your own ORM (Kysely, Drizzle, Prisma, raw drivers).
- **Simple mental model** — Job chains work like Promise chains. No determinism requirements, no replay semantics to learn.
- **Full type safety** — TypeScript inference for inputs, outputs, continuations, and blockers. Catch errors at compile time.
- **Flexible notifications** — Use Redis, NATS, or PostgreSQL LISTEN/NOTIFY for low-latency. Or just poll—no extra infrastructure required.
- **MIT licensed** — No enterprise licensing concerns.
