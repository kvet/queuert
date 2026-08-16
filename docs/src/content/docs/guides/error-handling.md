---
title: Error Handling
description: Discriminated unions, compensation patterns, and rescheduling.
sidebar:
  order: 7
---

Queuert provides only job completion -- there is no built-in "failure" state. This is intentional: you control how errors are represented in your job outputs.

## Discriminated Union

Return error information in your output type. The caller inspects the output to determine
success or failure.

```ts
const jobTypes = defineJobTypes<{
  "process-payment": {
    entry: true;
    input: { orderId: string };
    output: { success: true; transactionId: string } | { success: false; error: string };
  };
}>();
```

:::tip
This is the simplest approach and works well for most jobs. Prefer it when the caller needs to
react to the outcome, or when you want the error to be part of the chain's permanent record.
:::

## Compensation

For workflows that need rollback, continue to a compensation job that undoes previous steps.

```d2
...@../_classes.d2

direction: right

charge: "charge-card"     { class: job }
ship:   "ship-order"      { class: job }
refund: "refund-charge"   { class: job-muted }

charge -> ship:   "success"            { class: flow-green }
charge -> refund: "decline"            { class: flow-red }
ship   -> refund: "ship failed"        { class: flow-red }
```

```ts
const jobTypes = defineJobTypes<{
  "charge-card": {
    entry: true;
    input: { orderId: string };
    continueWith: { typeName: "ship-order" | "refund-charge" };
  };
  "ship-order": {
    input: { orderId: string; chargeId: string };
    output: { shipped: true };
    continueWith: { typeName: "refund-charge" }; // Can continue to refund on failure
  };
  "refund-charge": {
    input: { chargeId: string };
    output: { refunded: true };
  };
}>();
```

## Rescheduling

When a job throws an error, it's automatically rescheduled with exponential backoff:

```ts
const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "call-external-api": {
        attemptHandler: async ({ job, complete }) => {
          const response = await fetch(job.input.url);

          if (!response.ok) {
            // Rescheduled automatically with exponential backoff
            throw new Error(`API error: ${response.status}`);
          }

          const data = await response.json();
          return complete(async ({ finish }) => finish({ output: { data } }));
        },
      },
    },
  }),
});

const stop = await worker.start();
```

For explicit control over retry timing, see [Rescheduling from a Handler](../scheduling/#rescheduling-from-a-handler).

## lastAttemptError

On retry, `job.lastAttemptError` contains the serialized error from the previous attempt. Use it for logging or to adjust retry behavior:

```ts
attemptHandler: async ({ job, complete }) => {
  if (job.lastAttemptError != null) {
    console.log(`Previous attempt failed: ${job.lastAttemptError}`);
  }
  // ...
},
```

| Thrown value   | Stored as                                                                   |
| -------------- | --------------------------------------------------------------------------- |
| `Error` object | Stack trace (includes message). Own enumerable properties appended as JSON. |
| Plain object   | JSON-stringified                                                            |
| String         | Stored as-is                                                                |

Values are truncated to 10,000 characters.

See [examples/showcase-error-handling](https://github.com/kvet/queuert/tree/main/examples/showcase-error-handling) for a complete working example demonstrating discriminated unions, compensation patterns, and automatic backoff. See also [Job Processing Reliability](../processing-reliability/) for engine-level safety guarantees (savepoints, automatic rollback), [Timeouts](../timeouts/), and [Job Processing Modes](../processing-modes/).
