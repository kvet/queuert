# Built-in cleanup processors

Export a ready-made job type and processor factory for chain cleanup so users mount them
alongside their own registries instead of writing the cursor-paginate-delete-vacuum-reschedule
loop by hand.

## Problem

The cleanup guide (`docs/src/content/docs/guides/cleanup.md`) walks users through a ~60-line
attempt handler that every production deployment needs. The logic is identical across users:
paginate completed chains, delete in batches, vacuum, schedule the next run. The only meaningful
knob is retention duration.

Users who need per-type filtering, archival, or custom metrics can extend or replace the
built-in — but the default case shouldn't require copy-pasting boilerplate.

Additionally, users who use runtime validation (`createJobTypes` / `createZodJobTypes`) would
have to manually reconcile raw definition objects with their validated registry. Exporting a
factory that returns a fully constructed job types object avoids that friction.

## Solution

The library exports two things:

1. **`createCleanupJobTypes()`** — a factory returning a validated job types object the user
   passes alongside their own via the array merge pattern.
2. **`createCleanupProcessors({ requiredAttemptMiddleware? })`** — a factory returning a
   processors object the user passes alongside their own via the array merge pattern.

The user owns everything: worker placement, middleware, and scheduling.

### Job types factory

```ts
export function createCleanupJobTypes() {
  return createJobTypes({
    "__queuert/cleanup": {
      entry: true,
      input: { retentionMs: number },
      output: null,
    },
  });
}
```

No parameters for now — room to accept configuration (e.g. type-name constraints) later.

No `typeNames` filter in the input — the built-in deletes all completed chains older than the
cutoff. Users who need per-type retention write their own handler; the built-in and the guide
serve as the starting point.

### Processor factory

```ts
export function createCleanupProcessors({
  requiredAttemptMiddleware?,
}: {
  requiredAttemptMiddleware?: AttemptMiddleware[];
}) {
  return createProcessors({
    client,
    jobTypes: createCleanupJobTypes(),
    requiredAttemptMiddleware,
    processors: {
      "__queuert/cleanup": {
        attemptHandler: async ({ job, execute, complete }) => {
          // cursor-paginate completed chains older than cutoff
          // delete in batches via execute() — each batch in its own guarded transaction
          // vacuum
          // complete (no self-rescheduling — user controls the schedule)
        },
      },
    },
  });
}
```

The handler uses `execute` for each deletion batch — each call opens a fresh guarded
transaction with attempt verification, keeping lock scope bounded. The handler does not
self-reschedule. The user controls the interval at the scheduling call site.

### User setup

```ts
import { createCleanupJobTypes, createCleanupProcessors } from "@queuert/core";

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes: [createCleanupJobTypes(), myJobTypes],
});

const worker = await createInProcessWorker({
  client,
  processors: [
    createCleanupProcessors({ requiredAttemptMiddleware: [tracingMiddleware] }),
    myProcessors,
  ],
});
```

Both use the array merge pattern already supported by `createClient` and
`createInProcessWorker` — no spreading, no type gymnastics.

### Scheduling

The user schedules cleanup at application startup, controlling retention and interval:

```ts
await withTransactionHooks(async (transactionHooks) =>
  stateProvider.withTransaction(async (txCtx) =>
    client.createChain({
      ...txCtx,
      transactionHooks,
      typeName: "__queuert/cleanup",
      input: { retentionMs: 7 * 24 * 3600_000 },
      schedule: { afterMs: 3600_000 },
      deduplication: { key: "__queuert/cleanup", scope: "incomplete" },
    }),
  ),
);
```

Recurring scheduling uses the same `complete` → `createChain` with `schedule` + `deduplication`
pattern from the existing cleanup guide, but the handler's `complete` callback handles it
internally — the user only provides the initial schedule.

## Relationship to batched unblock

Same export pattern: job types factory + processor factory, both passed via array merge.
Together they establish the `__queuert/` namespace as a category of library-provided
processors, not a one-off.

## Docs

The existing cleanup guide becomes: "here's the built-in, here's how to schedule it, here's
how to customize or replace it if you outgrow it." Shorter and more useful.

## Tests

- Completed chains older than retention are deleted across batches.
- Chains younger than retention are preserved.
- The cleanup chain does not delete itself.
- Vacuum runs after deletion.
- User middleware (e.g. tracing) is invoked around the cleanup handler.
