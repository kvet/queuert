---
title: Timeouts
description: Cooperative and hard timeouts for job processing.
sidebar:
  order: 8
---

For cooperative timeouts, combine `AbortSignal.timeout()` with the provided `signal`:

```ts
const worker = await createInProcessWorker({
  client,
  processorRegistry: createJobTypeProcessorRegistry(client, jobTypeRegistry, {
    "fetch-data": {
      attemptHandler: async ({ signal, job, complete }) => {
        const timeout = AbortSignal.timeout(30_000); // 30 seconds
        const combined = AbortSignal.any([signal, timeout]);

        // Use combined signal for cancellable operations
        const response = await fetch(job.input.url, { signal: combined });
        const data = await response.json();

        return complete(() => ({ data }));
      },
    },
  }),
});

const stop = await worker.start();
```

For hard timeouts, configure `leaseConfig` in the job type processor -- if a job doesn't complete or renew its lease in time, the reaper reclaims it for retry:

```ts
const worker = await createInProcessWorker({
  client,
  processorRegistry: createJobTypeProcessorRegistry(client, jobTypeRegistry, {
    'long-running-job': {
      leaseConfig: { leaseMs: 300_000, renewIntervalMs: 60_000 }, // 5 min lease
      attemptHandler: async ({ job, complete }) => { ... },
    },
  }),
});
```

See [examples/showcase-timeouts](https://github.com/kvet/queuert/tree/main/examples/showcase-timeouts) for a complete working example demonstrating cooperative timeouts and hard timeouts via lease. See also [Error Handling](../error-handling/) and [In-Process Worker](/queuert/advanced/in-process-worker/) reference.
