---
title: Scheduling
description: Deferred start and recurring job patterns.
sidebar:
  order: 9
---

## Deferred Start

Jobs can be scheduled to start at a future time using the `schedule` option. The job is created transactionally but won't be processed until the specified time.

```ts
// Schedule a job to run in 5 minutes
await withTransactionHooks(async (transactionHooks) =>
  client.startJobChain({
    transactionHooks,
    typeName: "send-reminder",
    input: { userId: "123" },
    schedule: { afterMs: 5 * 60 * 1000 }, // 5 minutes from now
  }),
);

// Or schedule at a specific time
await withTransactionHooks(async (transactionHooks) =>
  client.startJobChain({
    transactionHooks,
    typeName: "send-reminder",
    input: { userId: "123" },
    schedule: { at: scheduledDate },
  }),
);
```

The same `schedule` option works with `continueWith` for deferred continuations:

```ts
return complete(async ({ continueWith }) =>
  continueWith({
    typeName: "follow-up",
    input: { userId: job.input.userId },
    schedule: { afterMs: 24 * 60 * 60 * 1000 }, // 24 hours later
  }),
);
```

## Recurring Jobs

For periodic tasks like daily digests, health checks, or billing cycles, start a new independent job chain from within the handler instead of using `continueWith`. This keeps each execution as its own short-lived chain rather than building an ever-growing chain history.

```ts
type Definitions = {
  'daily-digest': {
    entry: true;
    input: { userId: string };
    output: { sentAt: string };
  };
};

// In processor — start a new chain with a scheduled delay
'daily-digest': {
  attemptHandler: async ({ job, complete }) => {
    await sendDigestEmail(job.input.userId);

    return complete(async ({ sql, transactionHooks }) => {
      if (userStillSubscribed) {
        await client.startJobChain({
          sql,
          transactionHooks,
          typeName: 'daily-digest',
          input: { userId: job.input.userId },
          schedule: { afterMs: 24 * 60 * 60 * 1000 }, // Run again tomorrow
        });
      }
      return { sentAt: new Date().toISOString() };
    });
  },
}
```

See [examples/showcase-scheduling](https://github.com/kvet/queuert/tree/main/examples/showcase-scheduling) for a complete working example demonstrating recurring jobs with scheduling and deduplication. See also [Deduplication](../deduplication/) and [Transaction Hooks](../transaction-hooks/).
