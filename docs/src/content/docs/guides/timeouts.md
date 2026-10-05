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
        attemptHandler: async ({ signal, job, finish }) => {
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), 30_000);
          const combined = AbortSignal.any([signal, ac.signal]);

          try {
            const response = await fetch(job.input.url, { signal: combined });
            const data = await response.json();
            return withTransactionHooks(async (transactionHooks) =>
              db.transaction(async (tx) => finish({ tx, transactionHooks, output: { data } })),
            );
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

`attemptConfig` is not a runtime limit: it is the attempt's lease. The worker sets it when it acquires the job and its heartbeat renews it every `heartbeatMs` while the handler runs, so a handler may run far longer than `timeoutMs`. The lease only expires when the worker stops renewing it — it crashed, hung, or lost its database connection — and then another worker reclaims the job and retries it. Use the cooperative `signal` pattern above for real runtime limits.

```ts
const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "long-running-job": {
        attemptConfig: { timeoutMs: 300_000, heartbeatMs: 60_000 }, // reclaimed 5 min after the worker stops renewing
        attemptHandler: async ({ job, finish }) => { ... },
      },
    },
  }),
});
```

See [examples/showcase-timeouts](https://github.com/kvet/queuert/tree/main/examples/showcase-timeouts) for a complete working example demonstrating cooperative timeouts and the attempt lease, and [examples/showcase-long-running-jobs](https://github.com/kvet/queuert/tree/main/examples/showcase-long-running-jobs) for work that outlasts `timeoutMs` while the heartbeat renews the lease. See also [Error Handling](../error-handling/) and [In-Process Worker](/queuert/advanced/in-process-worker/) reference.
