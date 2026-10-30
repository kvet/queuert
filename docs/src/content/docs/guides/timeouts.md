---
title: Timeouts
description: Cooperative timeouts and the worker lease.
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

The worker `lease` is not a runtime limit: it bounds how long a worker may be unreachable. Each worker renews its lease every `heartbeatMs` while its handlers run, so a handler may run far longer than `durationMs`. A worker's jobs are reclaimed only once it stops renewing — it crashed, its event loop stalled, or it lost its database connection — and then another worker returns them to `pending` for a new attempt. Use the cooperative `signal` pattern above for real runtime limits.

```ts
const worker = await createInProcessWorker({
  client,
  lease: { durationMs: 120_000, heartbeatMs: 30_000 }, // jobs reclaimed about 2 min after the worker stops renewing
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "long-running-job": {
        attemptHandler: async ({ job, complete }) => { ... },
      },
    },
  }),
});
```

The lease is set per in-process worker, since it measures whether the process is alive, not how long any job type takes. The defaults are `durationMs: 60_000` and `heartbeatMs: 15_000`; `heartbeatMs` must be below a third of `durationMs`. The worker counts its lease as lost `durationMs − heartbeatMs` after its last successful renewal was sent, so with the defaults it survives one failed renewal. On loss, every attempt's `signal` aborts; see [In-Process Worker](/queuert/advanced/in-process-worker/#lease-and-heartbeat).

See [examples/showcase-timeouts](https://github.com/kvet/queuert/tree/main/examples/showcase-timeouts) for a complete working example demonstrating cooperative timeouts and the worker lease, and [examples/showcase-long-running-jobs](https://github.com/kvet/queuert/tree/main/examples/showcase-long-running-jobs) for work that outlasts `durationMs` while the heartbeat renews the lease. See also [Error Handling](../error-handling/) and [In-Process Worker](/queuert/advanced/in-process-worker/) reference.
