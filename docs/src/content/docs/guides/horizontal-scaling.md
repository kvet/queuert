---
title: Horizontal Scaling
description: Deploy multiple workers sharing the same database.
sidebar:
  order: 17
---

Deploy multiple worker processes sharing the same database for horizontal scaling. Workers coordinate via database-level locking (`FOR UPDATE SKIP LOCKED`) — no external coordination required.

## Identical Workers

The simplest approach: deploy the same worker configuration on multiple machines or processes.

```ts
// Process A (e.g., machine-1)
const workerA = await createInProcessWorker({
  client,
  workerId: "worker-a",
  concurrency: 10,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({ client, jobTypeRegistry, processors: { ... } }),
});

// Process B (e.g., machine-2)
const workerB = await createInProcessWorker({
  client,
  workerId: "worker-b",
  concurrency: 10,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({ client, jobTypeRegistry, processors: { ... } }),
});
```

Each worker needs a unique `workerId`. Workers compete for available jobs — when one acquires a job, others skip it. The notify adapter (Redis, PostgreSQL LISTEN/NOTIFY, etc.) ensures workers wake up immediately when new jobs are queued.

## Specialized Workers

A worker only processes the job types in its processor registry. This lets you run different worker topologies optimized for different workloads — a worker that doesn't define a processor for a job type simply ignores it. The same mechanism powers [prioritization](../prioritization/): reserve capacity for an urgent workload by giving it a worker of its own.

For CPU-heavy work, spawn each worker in its own thread so they get true parallelism. Each thread creates its own client, state adapter, and worker — they share nothing except the database:

```ts title="image-worker-thread.ts"
// Each thread runs independently with its own database connection
const stateAdapter = await createPgStateAdapter({ stateProvider });
const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypeRegistry: imageJobTypeRegistry,
});

const worker = await createInProcessWorker({
  client,
  workerId: `image-worker-${threadId}`,
  concurrency: 1,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
    client,
    jobTypeRegistry: imageJobTypeRegistry,
    processors: {
      "images.resize": { attemptHandler: resizeHandler },
      "images.transcode": { attemptHandler: transcodeHandler },
    },
  }),
});
```

```ts title="main.ts"
import { Worker } from "node:worker_threads";

// 10 threads for CPU-heavy image processing
for (let i = 0; i < 10; i++) {
  new Worker("./image-worker-thread.ts");
}

// Lightweight async I/O — single worker in main thread, high concurrency
const notificationWorker = await createInProcessWorker({
  client,
  workerId: "notification-worker",
  concurrency: 100,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
    client,
    jobTypeRegistry: notificationJobTypeRegistry,
    processors: {
      "notifications.send-email": { attemptHandler: emailHandler },
      "notifications.send-sms": { attemptHandler: smsHandler },
    },
  }),
});
```

This works because job chains are stored in the database, not in worker memory. A chain that starts with `images.resize` (picked up by an image worker thread) can `continueWith` to `notifications.send-email` (picked up by the notification worker in the main thread) — the handoff happens through the database.

You can also combine slices when a single worker should handle multiple domains:

```ts
const worker = await createInProcessWorker({
  client,
  jobTypeProcessorRegistry: mergeJobTypeProcessorRegistries({
    slices: [orderProcessors, notificationProcessors],
  }),
});
```

See [Feature Slices](../slices/) for organizing job types and processors into independent modules.

## See Also

- [examples/state-postgres-multi-worker](https://github.com/kvet/queuert/tree/main/examples/state-postgres-multi-worker) — multiple workers sharing a PostgreSQL database
- [Prioritization](../prioritization/) — reserving worker capacity for urgent workloads
- [In-Process Worker](/queuert/advanced/in-process-worker/) — worker lifecycle and configuration
- [State Adapters](/queuert/integrations/state-adapters/) — database adapter setup
