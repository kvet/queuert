---
title: Job Processing Modes
description: Choosing between atomic and staged modes, auto-setup defaults, and common anti-patterns.
sidebar:
  order: 2
---

## Atomic Mode

```d2
...@../_classes.d2

direction: right

txn: "transaction" {
  class: txn

  prepare: "prepare() — read (optional)" {
    class: client
    style.stroke-dash: 4
  }

  complete: "complete() — write" { class: step }

  prepare -> complete { class: flow }
}
```

Most jobs don't need `prepare`. Call `complete` directly and you get atomic mode automatically — one transaction for all reads and writes:

```ts
'reserve-inventory': {
  attemptHandler: async ({ job, complete }) => {
    return complete(async ({ sql }) => {
      const [item] = await sql`SELECT stock FROM items WHERE id = ${job.input.id}`;
      if (item.stock < 1) throw new Error("Out of stock");
      await sql`UPDATE items SET stock = stock - 1 WHERE id = ${job.input.id}`;
      return { reserved: true };
    });
  },
}
```

This is the default path. If you're not sure which mode to use, start here.

## Staged Mode

```d2
...@../_classes.d2

direction: right

txn1: "transaction" {
  class: txn
  prepare: "prepare() — read" { class: step }
}

external: "no transaction\nexternal work\nmust be idempotent" { class: job-muted; width: 260; height: 100 }

txn2: "transaction" {
  class: txn
  complete: "complete() — write" { class: step }
}

txn1.prepare -> external { class: flow }
external     -> txn2.complete { class: flow }
external     -> external: "attempt auto-extends\nworker keeps the attempt" { class: wake }
```

Use staged mode when you need to do work **between** two transactions — typically external API calls that shouldn't hold a database transaction open:

```ts
'charge-payment': {
  attemptHandler: async ({ job, prepare, complete }) => {
    // Phase 1: Read state (transaction)
    const order = await prepare({ mode: "staged" }, async ({ sql }) => {
      const [row] = await sql`SELECT * FROM orders WHERE id = ${job.input.id}`;
      return row;
    });
    // Transaction closed, heartbeat active

    // Phase 2: External API call (no transaction)
    const { paymentId } = await paymentAPI.charge(order.amount);

    // Phase 3: Write results (new transaction)
    return complete(async ({ sql }) => {
      await sql`UPDATE orders SET payment_id = ${paymentId} WHERE id = ${order.id}`;
      return { paymentId };
    });
  },
}
```

### Intermediate Transactions with `execute`

```d2
...@../_classes.d2

direction: right

txn1: "transaction" {
  class: txn
  prepare: "prepare()" { class: step }
}

txn2: "transaction" {
  class: txn
  execute: "execute() — batch 1" { class: step }
}

txn3: "transaction" {
  class: txn
  execute2: "execute() — batch N" { class: step }
}

txn4: "transaction" {
  class: txn
  complete: "complete()" { class: step }
}

txn1.prepare -> txn2.execute { class: flow }
txn2.execute -> txn3.execute2 { class: flow }
txn3.execute2 -> txn4.complete { class: flow }
```

Within staged mode, `execute` lets you perform **multiple independent transactions** between `prepare` and `complete` — typically for batched work or checkpointed aggregation:

```ts
'aggregate-metrics': {
  attemptHandler: async ({ job, execute, complete }) => {
    let totalProcessed = 0;
    let cursor;

    do {
      const batch = await execute(async ({ sql }) => {
        const rows = await sql`
          SELECT id, value FROM raw_events
          WHERE processed = false
          ORDER BY id LIMIT 500
        `;
        if (rows.length > 0) {
          await sql`
            UPDATE raw_events SET processed = true
            WHERE id = ANY(${rows.map(r => r.id)})
          `;
        }
        return { count: rows.length, nextCursor: rows.at(-1)?.id };
      });
      totalProcessed += batch.count;
      cursor = batch.count === 500 ? batch.nextCursor : undefined;
    } while (cursor);

    return complete(async () => ({ totalProcessed }));
  },
}
```

Each `execute` call opens a fresh guarded transaction (attempt verified), runs the callback, commits, and flushes hooks. If `prepare` hasn't been called, `execute` automatically enters staged mode.

## When to Use What

```
Do you need to call an external API or do long-running
work between reading and writing?
  ├── No  → Just call complete() directly (auto-setup atomic)
  └── Yes → Use prepare({ mode: "staged" })
            ├── Single external call → Read in prepare, do external work, write in complete
            └── Batched transactional work → Use execute() between prepare and complete
```

In practice, explicit `prepare` with a fixed mode is rarely needed. `prepare({ mode: "atomic" })` does the same thing as calling `complete` directly but with extra ceremony. The main reason to use explicit `prepare` is when the mode is **dynamic** — determined at runtime based on job input or application state.

## Auto-Setup

When you skip `prepare`, Queuert infers the mode from how you call `complete`:

| Pattern                                 | Mode   | What happens                                   |
| --------------------------------------- | ------ | ---------------------------------------------- |
| `return complete(...)` (synchronous)    | Atomic | Single transaction wraps everything            |
| `await something; return complete(...)` | Staged | Heartbeat runs between async work and complete |

This means even without `prepare`, you can get staged behavior by doing async work before calling `complete`:

```ts
'send-notification': {
  attemptHandler: async ({ job, complete }) => {
    await emailService.send(job.input.to, job.input.body);

    return complete(async ({ sql }) => {
      await sql`UPDATE notifications SET sent = true WHERE id = ${job.input.id}`;
      return { sentAt: new Date().toISOString() };
    });
  },
}
```

## Anti-Patterns

:::caution[Using staged mode with nothing between prepare and complete]
Staged mode adds a round-trip and loses read consistency for no benefit. Put everything in
`complete()` instead.

```ts
attemptHandler: async ({ job, prepare, complete }) => {
  const data = await prepare({ mode: "staged" }, async ({ sql }) => {
    return (await sql`SELECT * FROM items WHERE id = ${job.input.id}`)[0];
  });
  return complete(async ({ sql }) => {
    await sql`UPDATE items SET status = 'done' WHERE id = ${data.id}`;
    return { done: true };
  });
};
```

:::

:::caution[Using prepare with atomic mode when complete alone suffices]
This is the same as calling `complete()` directly, but with extra ceremony.

```ts
attemptHandler: async ({ job, prepare, complete }) => {
  const item = await prepare({ mode: "atomic" }, async ({ sql }) => {
    return (await sql`SELECT stock FROM items WHERE id = ${job.input.id}`)[0];
  });
  return complete(async ({ sql }) => {
    await sql`UPDATE items SET stock = stock - 1 WHERE id = ${job.input.id}`;
    return { reserved: true };
  });
};
```

:::

The exception is dynamic handlers where the mode is determined at runtime — explicit `prepare` is the right choice there since auto-setup can't express conditional logic.

## See Also

See [examples/showcase-processing-modes](https://github.com/kvet/queuert/tree/main/examples/showcase-processing-modes) for a complete working example. See also [Job Processing Reliability](../processing-reliability/), [Error Handling](../error-handling/), [Timeouts](../timeouts/), and [Job Processing](/queuert/advanced/job-processing/) reference.
