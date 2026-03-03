---
title: Horizontal Scaling
description: Deploy multiple workers sharing the same database.
sidebar:
  order: 14
---

Deploy multiple worker processes sharing the same database for horizontal scaling. Workers coordinate via database-level locking (`FOR UPDATE SKIP LOCKED`) -- no external coordination required.

```ts
// Process A (e.g., machine-1)
const worker = await createInProcessWorker({
  client,
  workerId: "worker-a",
  concurrency: 10,
  processors: { ... },
});

// Process B (e.g., machine-2)
const worker = await createInProcessWorker({
  client,
  workerId: "worker-b",
  concurrency: 10,
  processors: { ... },
});
```

Each worker needs a unique `workerId`. Workers compete for available jobs -- when one acquires a job, others skip it. The notify adapter (Redis, PostgreSQL LISTEN/NOTIFY, etc.) ensures workers wake up immediately when new jobs are queued.

See [examples/state-postgres-multi-worker](https://github.com/kvet/queuert/tree/main/examples/state-postgres-multi-worker) for a complete example spawning multiple worker processes sharing a PostgreSQL database. See also [In-Process Worker](/queuert/advanced/in-process-worker/) reference and [State Adapters](/queuert/integrations/state-adapters/).
