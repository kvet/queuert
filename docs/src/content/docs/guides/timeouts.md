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

The worker's lease (`leaseConfig`) is not a runtime limit: it bounds how long a crashed worker's jobs wait before another worker picks them up. Each worker's heartbeat renews its lease every `heartbeatMs`, however many attempts it runs, so a handler may run far longer than `durationMs`. The lease only expires when the worker stops renewing it — it crashed, its event loop stalled, or it lost its database connection. On the in-process and SQLite adapters, a user transaction that holds the write lock past the worker's local deadline also makes the worker give up its lease (see [Worker Lease](../../how-it-works/in-process-worker/#worker-lease)). Either way the jobs running under it are reclaimed and start a new attempt. Use the cooperative `signal` pattern above for real runtime limits.

```ts
const worker = await createInProcessWorker({
  client,
  leaseConfig: { durationMs: 300_000, heartbeatMs: 60_000 }, // jobs reclaimed 5 min after the worker stops renewing
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

See [examples/showcase-timeouts](https://github.com/kvet/queuert/tree/main/examples/showcase-timeouts) for a complete working example demonstrating cooperative timeouts and a job that outlasts `durationMs` while the heartbeat renews the lease. See also [Error Handling](../error-handling/) and [In-Process Worker](/queuert/how-it-works/in-process-worker/#worker-lease) reference.
