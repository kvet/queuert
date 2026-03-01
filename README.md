# Queuert

[![npm version](https://img.shields.io/npm/v/queuert.svg)](https://www.npmjs.com/package/queuert)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)

Control flow library for your persistency layer driven applications.

[**Documentation**](https://kvet.github.io/queuert/) | [**Getting Started**](https://kvet.github.io/queuert/getting-started/introduction/) | [**API Reference**](https://kvet.github.io/queuert/reference/client-api/)

Run your application logic as a series of background jobs that are started alongside state change transactions in your persistency layer. Perform long-running tasks with side-effects reliably in the background and keep track of their progress in your database. Own your stack and avoid vendor lock-in by using the tools you trust.

## Quick Example

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

We scheduled the job inside a database transaction. This ensures that if the transaction rolls back (e.g., user creation fails), the job is not started. No orphaned emails. (Refer to transactional outbox pattern.)

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

await worker.start();
```

## Why Queuert?

- **Your database is the source of truth** — No separate persistence layer. Jobs live alongside your application data.
- **True transactional consistency** — Start jobs inside your database transactions. If the transaction rolls back, the job is never created. No dual-write problems.
- **No vendor lock-in** — Works with PostgreSQL and SQLite. Bring your own ORM (Kysely, Drizzle, Prisma, raw drivers).
- **Simple mental model** — Job chains work like Promise chains. No determinism requirements, no replay semantics to learn.
- **Full type safety** — TypeScript inference for inputs, outputs, continuations, and blockers. Catch errors at compile time.
- **Flexible notifications** — Use Redis, NATS, or PostgreSQL LISTEN/NOTIFY for low-latency. Or just poll—no extra infrastructure required.
- **MIT licensed** — No enterprise licensing concerns.

## Installation

```bash
# Core package (required)
npm install queuert

# State adapters (pick one)
npm install @queuert/postgres  # PostgreSQL - recommended for production
npm install @queuert/sqlite    # SQLite (experimental)

# Notify adapters (optional, for reduced latency)
npm install @queuert/redis     # Redis pub/sub - recommended for production
npm install @queuert/nats      # NATS pub/sub (experimental)
# Or use PostgreSQL LISTEN/NOTIFY via @queuert/postgres (no extra infra)

# Dashboard (optional)
npm install @queuert/dashboard  # Embeddable web UI for job observation

# Observability (optional)
npm install @queuert/otel      # OpenTelemetry metrics and histograms
```

## Learn More

Visit the [documentation site](https://kvet.github.io/queuert/) for guides on:

- [Transaction Hooks](https://kvet.github.io/queuert/guides/transaction-hooks/)
- [Job Processing Modes](https://kvet.github.io/queuert/guides/processing-modes/)
- [Job Chain Patterns](https://kvet.github.io/queuert/guides/chain-patterns/)
- [Error Handling](https://kvet.github.io/queuert/guides/error-handling/)
- [Scheduling & Recurring Jobs](https://kvet.github.io/queuert/guides/scheduling/)
- [Deduplication](https://kvet.github.io/queuert/guides/deduplication/)
- [Horizontal Scaling](https://kvet.github.io/queuert/guides/horizontal-scaling/)
- [Dashboard](https://kvet.github.io/queuert/integrations/dashboard/)
- [Observability](https://kvet.github.io/queuert/integrations/observability/)
- And more...

## License

MIT
