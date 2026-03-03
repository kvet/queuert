---
title: Job Processing Modes
description: Atomic mode, staged mode, and auto-setup.
sidebar:
  order: 2
---

Jobs support two processing modes via the `prepare` function:

## Atomic Mode

Prepare and complete run in ONE transaction. Use when reads and writes must be atomic.

```ts
'reserve-inventory': {
  attemptHandler: async ({ job, prepare, complete }) => {
    const item = await prepare({ mode: "atomic" }, async ({ sql }) => {
      const [row] = await sql`SELECT stock FROM items WHERE id = ${job.input.id}`;
      if (row.stock < 1) throw new Error("Out of stock");
      return row;
    });

    // Complete runs in SAME transaction as prepare
    return complete(async ({ sql }) => {
      await sql`UPDATE items SET stock = stock - 1 WHERE id = ${job.input.id}`;
      return { reserved: true };
    });
  },
}
```

## Staged Mode

Prepare and complete run in SEPARATE transactions. Use for external API calls or long-running operations that shouldn't hold a database transaction open.

```ts
'charge-payment': {
  attemptHandler: async ({ job, prepare, complete }) => {
    // Phase 1: Prepare (transaction)
    const order = await prepare({ mode: "staged" }, async ({ sql }) => {
      const [row] = await sql`SELECT * FROM orders WHERE id = ${job.input.id}`;
      return row;
    });
    // Transaction closed, lease renewal active

    // Phase 2: Processing (no transaction)
    const { paymentId } = await paymentAPI.charge(order.amount);

    // Phase 3: Complete (new transaction)
    return complete(async ({ sql }) => {
      await sql`UPDATE orders SET payment_id = ${paymentId} WHERE id = ${order.id}`;
      return { paymentId };
    });
  },
}
```

## Auto-Setup

If you don't call `prepare`, auto-setup runs based on when you call `complete`:

- Call `complete` synchronously -- atomic mode
- Call `complete` after async work -- staged mode (lease renewal active)

See [examples/showcase-processing-modes](https://github.com/kvet/queuert/tree/main/examples/showcase-processing-modes) for a complete working example demonstrating all three modes through an order fulfillment workflow. See also [Error Handling](../error-handling/), [Timeouts](../timeouts/), and [Job Processing](/queuert/advanced/job-processing/) reference.
