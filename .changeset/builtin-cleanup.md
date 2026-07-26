---
"queuert": minor
---

Add a built-in cleanup job so retention no longer requires hand-writing the paginate-delete-reschedule loop. Mount `createCleanupJobTypes()` on the client and `createCleanupProcessors({ client })` on a worker via the usual array merge, then schedule the first run with `typeName: "__queuert/cleanup"` and an input of `{ retentionMs, intervalMs }` — every subsequent run schedules itself. The handler deletes all completed chains older than the cutoff in batches, each batch in its own guarded transaction, never deletes its own chain, and drops out between batches when the worker is stopping.

- `createCleanupJobTypes()` — validated job types for `__queuert/cleanup`, composable with `defineJobTypes` and schema-validated slices
- `createCleanupProcessors({ client, attemptMiddleware?, batchSize? })` — the cleanup processor; `attemptMiddleware` lets the slice satisfy a worker's `requiredAttemptMiddleware`, and `batchSize` defaults to 100
- The handler does not vacuum — `vacuum()` lives on the concrete state adapters, so call `stateAdapter.vacuum()` yourself on whatever cadence suits your deployment
