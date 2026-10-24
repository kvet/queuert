---
title: Timeouts
description: Cooperative timeouts and the attempt timeout.
sidebar:
  order: 8
---

For cooperative timeouts, combine a per-job `AbortController` with the provided `signal` and pass the combined signal to the work:

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
            return await withTransactionHooks(async (transactionHooks) =>
              sql.begin(async (txSql) => complete({ txSql, transactionHooks, output: { data } })),
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

`attemptConfig` is not a runtime limit: it is the attempt's timeout. The worker sets `attemptUntil` when it acquires the job and its heartbeat extends it every `heartbeatMs` while the handler runs, so a handler may run far longer than `timeoutMs`. The attempt only expires when the worker stops extending it — it crashed, its event loop stalled, or it lost its database connection — and then another worker reclaims the job and starts a new attempt. Use the cooperative `signal` pattern above for real runtime limits.

```ts
const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "long-running-job": {
        attemptConfig: { timeoutMs: 300_000, heartbeatMs: 60_000 }, // reclaimed 5 min after the worker stops extending
        attemptHandler: async ({ job, complete }) => { ... },
      },
    },
  }),
});
```

See [examples/showcase-timeouts](https://github.com/kvet/queuert/tree/main/examples/showcase-timeouts) for a complete working example demonstrating cooperative timeouts and the attempt timeout, and [examples/showcase-long-running-jobs](https://github.com/kvet/queuert/tree/main/examples/showcase-long-running-jobs) for work that outlasts `timeoutMs` while the heartbeat extends the attempt. See also [Error Handling](../error-handling/) and [In-Process Worker](/queuert/advanced/in-process-worker/) reference.
