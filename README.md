# Queuert

[![npm version](https://img.shields.io/npm/v/queuert.svg)](https://www.npmjs.com/package/queuert)
[![license](https://img.shields.io/github/license/kvet/queuert.svg)](https://github.com/kvet/queuert/blob/main/LICENSE)

**Durable, typed job chains that commit with your database transactions.**

Queuert is a job-chain library — durable, typed background work in your database. Job chains compose like Promise chains (`.then`, `Promise.all`), but they survive crashes and commit with your transactions. Postgres or SQLite, no Redis required, no separate server.

[**Documentation**](https://kvet.github.io/queuert/) | [**Getting Started**](https://kvet.github.io/queuert/getting-started/introduction/) | [**Comparison**](https://kvet.github.io/queuert/comparison/)

## How it looks

Define a typed chain of jobs. Each step's input, output, and continuation are inferred — wrong-shape continuations are compile errors.

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

Start the chain _inside_ your DB transaction. If the transaction rolls back, the chain is never created. No outbox glue, no dual-write window.

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

Each handler continues with the next step. The compiler enforces that `continueWith` matches the declared next type's input.

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

Background-work libraries trade off across two axes: what storage tier they own, and what shape of work they model.

|                       | Queuert               | pg-boss             | BullMQ            | Temporal          | Inngest           |
| --------------------- | --------------------- | ------------------- | ----------------- | ----------------- | ----------------- |
| Category              | Job-chain library     | Job queue           | Job queue         | Workflow platform | Workflow platform |
| Storage               | Your DB (PG / SQLite) | Postgres            | Redis             | Separate cluster  | Inngest server    |
| Transactional enqueue | ✅ structural         | 🟡 per-call adapter | ❌ app discipline | ❌ app discipline | ❌ app discipline |
| Operate a server?     | No                    | No                  | Redis             | Yes               | Yes               |

Queuert sits between job queues and workflow engines. A one-job chain _is_ a queue; a multi-step chain with blockers is closer to a workflow. Neither label fully fits, which is why the canonical term is "job-chain library."

For deeper comparisons, see the [docs site](https://kvet.github.io/queuert/comparison/) — one page per neighbor.

## Why Queuert

- **Transactional, both ends.** Enqueue commits inside your DB transaction; handler completion and next-step `continueWith` commit in the same transaction as your domain writes. For DB-bound work, no outbox at enqueue and no idempotency-key ritual at processing — both halves are structural.
- **Typed job chains.** Inputs, outputs, continuations, and blockers infer end-to-end via `defineJobTypes`. Refactoring is compiler-checked.
- **Lives in your database.** Postgres or SQLite. No Redis required, no workflow server, no separate persistence tier to operate.
- **Sub-second wakeup.** `LISTEN/NOTIFY` (or Redis pub/sub, or NATS) wakes workers when a row commits — not on a polling timer.
- **Schedule for later.** Delay a chain to a specific time or duration. Schedule retries with backoff. Future work, no extra infrastructure.
- **Deduplication.** Pass a deduplication key on enqueue. Identical keys collapse to a single chain — at-most-once, by construction.

## Installation

```bash
# Core (required)
npm install queuert

# State adapter (pick one)
npm install @queuert/postgres   # PostgreSQL — recommended for production
npm install @queuert/sqlite     # SQLite (experimental)

# Notify adapter (optional, for sub-second wakeup)
npm install @queuert/redis      # Redis pub/sub
npm install @queuert/nats       # NATS pub/sub (experimental)
# Or use PostgreSQL LISTEN/NOTIFY via @queuert/postgres — no extra infra

# Dashboard (optional, experimental)
npm install @queuert/dashboard

# Observability (optional)
npm install @queuert/otel
```

## Learn more

- [Getting Started](https://kvet.github.io/queuert/getting-started/introduction/)
- [Chain Patterns](https://kvet.github.io/queuert/guides/chain-patterns/)
- [Transaction Hooks](https://kvet.github.io/queuert/guides/transaction-hooks/)
- [Job Blockers](https://kvet.github.io/queuert/guides/job-blockers/)
- [Comparison with other libraries](https://kvet.github.io/queuert/comparison/)
- [Benchmarks](https://kvet.github.io/queuert/benchmarks/)
- [API Reference](https://kvet.github.io/queuert/reference/queuert/client/)

## License

MIT.
