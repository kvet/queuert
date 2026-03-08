---
title: Error Handling
description: Discriminated unions, compensation patterns, and rescheduling.
sidebar:
  order: 7
---

Queuert provides only job completion -- there is no built-in "failure" state. This is intentional: you control how errors are represented in your job outputs.

Handle failures by returning error information in your output types:

```ts
type Definitions = {
  "process-payment": {
    entry: true;
    input: { orderId: string };
    output: { success: true; transactionId: string } | { success: false; error: string };
  };
};
```

For workflows that need rollback, use the compensation pattern -- a "failed" job can continue to a compensation job that undoes previous steps:

```ts
type Definitions = {
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
};
```

## Explicit Rescheduling

When a job throws an error, it's automatically rescheduled with exponential backoff. For transient failures where you want explicit control over retry timing, use `rescheduleJob`:

```ts
import { rescheduleJob } from "queuert";

const worker = await createInProcessWorker({
  client,
  processorRegistry: defineJobTypeProcessorRegistry(client, jobTypes, {
    "call-external-api": {
      attemptHandler: async ({ job, prepare, complete }) => {
        const response = await fetch(job.input.url);

        if (response.status === 429) {
          // Rate limited — retry after the specified delay
          const retryAfter = parseInt(response.headers.get("Retry-After") || "60", 10);
          rescheduleJob({ afterMs: retryAfter * 1000 });
        }

        if (!response.ok) {
          // Other errors use default exponential backoff
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        return complete(() => ({ data }));
      },
    },
  }),
});

const stop = await worker.start();
```

The `rescheduleJob` function throws a `RescheduleJobError` which the worker catches specially. Unlike regular errors that trigger exponential backoff based on attempt count, `rescheduleJob` uses your specified schedule exactly:

```ts
// Retry after a delay
rescheduleJob({ afterMs: 30_000 }); // 30 seconds from now

// Retry at a specific time
rescheduleJob({ at: new Date("2026-06-15T09:00:00Z") });

// Include the original error as cause (for logging/debugging)
rescheduleJob({ afterMs: 60_000 }, originalError);
```

See [examples/showcase-error-handling](https://github.com/kvet/queuert/tree/main/examples/showcase-error-handling) for a complete working example demonstrating discriminated unions, compensation patterns, and explicit rescheduling. See also [Timeouts](../timeouts/) and [Job Processing Modes](../processing-modes/).
