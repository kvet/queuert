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
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "fetch-data": {
        attemptHandler: async ({ signal, job, complete }) => {
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), 30_000);
          const combined = AbortSignal.any([signal, ac.signal]);

          try {
            const response = await fetch(job.input.url, { signal: combined });
            const data = await response.json();
            return complete(async ({ finish }) => finish({ output: { data } }));
          } finally {
            clearTimeout(timer);
          }
        },
      },
    },
  }),
});

const stop = await worker.start();
```

For hard timeouts, configure `attemptConfig` in the job type processor -- if a job doesn't complete or extend the attempt in time, the attempt expires and is released for retry:

```ts
const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "long-running-job": {
        attemptConfig: { timeoutMs: 300_000, heartbeatMs: 60_000 }, // 5 min timeout
        attemptHandler: async ({ job, complete }) => { ... },
      },
    },
  }),
});
```

See [examples/showcase-timeouts](https://github.com/kvet/queuert/tree/main/examples/showcase-timeouts) for a complete working example demonstrating cooperative timeouts and hard timeouts via attempt expiry. See also [Error Handling](../error-handling/) and [In-Process Worker](/queuert/advanced/in-process-worker/) reference.
