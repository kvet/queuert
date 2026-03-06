---
title: Job Processing Modes
description: Choosing between atomic and staged modes, auto-setup defaults, and common anti-patterns.
sidebar:
  order: 2
---

## Start Simple: Just Call `complete`

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

## When You Need Staged Mode

Use staged mode when you need to do work **between** two transactions — typically external API calls that shouldn't hold a database transaction open:

```ts
'charge-payment': {
  attemptHandler: async ({ job, prepare, complete }) => {
    // Phase 1: Read state (transaction)
    const order = await prepare({ mode: "staged" }, async ({ sql }) => {
      const [row] = await sql`SELECT * FROM orders WHERE id = ${job.input.id}`;
      return row;
    });
    // Transaction closed, lease renewal active

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

## When to Use What

```
Do you need to call an external API or do long-running
work between reading and writing?
  ├── No  → Just call complete() directly (auto-setup atomic)
  └── Yes → Use prepare({ mode: "staged" })
            Read in prepare, do external work, write in complete
```

In practice, explicit `prepare` with a fixed mode is rarely needed. `prepare({ mode: "atomic" })` does the same thing as calling `complete` directly but with extra ceremony. The main reason to use explicit `prepare` is when the mode is **dynamic** — determined at runtime based on job input or application state.

## Auto-Setup

When you skip `prepare`, Queuert infers the mode from how you call `complete`:

| Pattern                                 | Mode   | What happens                                       |
| --------------------------------------- | ------ | -------------------------------------------------- |
| `return complete(...)` (synchronous)    | Atomic | Single transaction wraps everything                |
| `await something; return complete(...)` | Staged | Lease renewal runs between async work and complete |

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

**Using staged mode with nothing between prepare and complete:**

```ts
// Don't do this — staged mode adds a round-trip and loses read consistency
// for no benefit. Just put everything in complete().
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

**Using `prepare({ mode: "atomic" })` when `complete` alone suffices:**

```ts
// Don't do this when the mode is always atomic — it's the same as calling
// complete() directly, but with extra ceremony.
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

The exception is dynamic handlers where the mode is determined at runtime — explicit `prepare` is the right choice there since auto-setup can't express conditional logic.

## See Also

See [examples/showcase-processing-modes](https://github.com/kvet/queuert/tree/main/examples/showcase-processing-modes) for a complete working example. See also [Error Handling](../error-handling/), [Timeouts](../timeouts/), and [Job Processing](/queuert/advanced/job-processing/) reference.
