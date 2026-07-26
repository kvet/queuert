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
2. **`createCleanupProcessors({ client, attemptMiddleware? })`** — a factory returning a
   processors object the user passes alongside their own via the array merge pattern.

The user owns everything: worker placement, middleware, and the initial schedule.

### Job types factory

```ts
export function createCleanupJobTypes() {
  return createJobTypes<{
    "__queuert/cleanup": {
      entry: true;
      input: { retentionMs: number; intervalMs: number };
      output: null;
    };
  }>({
    getTypeNames: () => ["__queuert/cleanup"],
    validateEntry: (typeName) => {
      /* only "__queuert/cleanup", which is an entry */
    },
    parseInput: (typeName, input) => {
      /* assert retentionMs / intervalMs are finite non-negative numbers */
    },
    parseOutput: (typeName, output) => {
      /* assert null */
    },
    validateContinueWith: () => {
      /* cleanup never continues */
    },
    validateBlockers: () => {
      /* cleanup takes no blockers */
    },
  });
}
```

`createJobTypes` takes hand-written validation callbacks rather than a schema, so the built-in
supplies its own runtime validation and merges cleanly with both `defineJobTypes` (noop) slices
and validated (`createZodJobTypes`) slices.

No parameters for now — room to accept configuration (e.g. type-name constraints) later.

No `typeNames` filter in the input — the built-in deletes all completed chains older than the
cutoff. Users who need per-type retention write their own handler; the built-in and the guide
serve as the starting point.

`intervalMs` rides in the input because the handler self-reschedules (see [Scheduling](#scheduling)) —
the recurrence period has to survive from one run to the next, and the input is the only channel
that does.

### Processor factory

```ts
export function createCleanupProcessors({
  client,
  attemptMiddleware,
}: {
  client: Client<...>;
  attemptMiddleware?: AttemptMiddleware[];
}) {
  return createProcessors({
    client,
    jobTypes: createCleanupJobTypes(),
    attemptMiddleware,
    processors: {
      "__queuert/cleanup": {
        attemptHandler: async ({ job, execute, complete }) => {
          // cursor-paginate completed chains older than cutoff (excluding job.chainId)
          // delete in batches via execute() — each batch in its own guarded transaction
          // TODO: vacuum — see "Vacuum" below; not reachable from core yet
          // complete: self-reschedule the next run, return null
        },
      },
    },
  });
}
```

`client` is required: `createProcessors` needs it, and it carries the `TStateAdapter` generic
that the middleware types are checked against. The factory's `client` parameter inherits
`createProcessors`' constraint that the client's job types be a superset of the slice's — which
is exactly the check that catches a user who mounted the processors but forgot
`createCleanupJobTypes()` on the client.

`attemptMiddleware` (not `requiredAttemptMiddleware`) — it is passed straight through to
`createProcessors` as this slice's own middleware chain. Its purpose is to let the built-in slice
satisfy a worker configured with `requiredAttemptMiddleware`, which enforces by reference
identity that every dispatched slice includes the required instances as an in-order subsequence.

The handler uses `execute` for each deletion batch — each call opens a fresh guarded
transaction with attempt verification, keeping lock scope bounded.

### Vacuum

Deferred. `vacuum()` is not part of the core `StateAdapter` interface — it exists only on the
concrete PostgreSQL and SQLite adapters, and not at all on the in-process adapter — so a
core-exported processor cannot call it. The handler carries a comment marking where the vacuum
step belongs. Resolving it later means either an optional `vacuum?: () => Promise<void>` on the
factory options or hoisting an optional `vacuum` onto the core `StateAdapter` interface.

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

The user schedules only the **first** run at application startup, choosing retention and
interval. Deduplication makes startup idempotent, so calling it on every boot is safe:

```ts
await withTransactionHooks(async (transactionHooks) =>
  stateProvider.withTransaction(async (txCtx) =>
    client.createChain({
      ...txCtx,
      transactionHooks,
      typeName: "__queuert/cleanup",
      input: { retentionMs: 7 * 24 * 3600_000, intervalMs: 3600_000 },
      deduplication: { key: "__queuert/cleanup", scope: "running" },
    }),
  ),
);
```

Every subsequent run is scheduled by the handler itself, following the recurring-jobs pattern
from `docs/src/content/docs/guides/scheduling.mdx`: the `complete` callback starts a **new
independent chain** (not `continueWith`, so each run stays a short-lived chain rather than an
ever-growing history), forwarding `job.input` unchanged so retention and interval persist across
runs:

```ts
return complete(async ({ transactionHooks, ...txCtx }) => {
  await client.createChain({
    ...txCtx,
    transactionHooks,
    typeName: "__queuert/cleanup",
    input: job.input,
    schedule: { afterMs: job.input.intervalMs },
    deduplication: {
      key: "__queuert/cleanup",
      scope: "running",
      excludeChainIds: [job.chainId],
    },
  });
  return null;
});
```

`scope: "running"` keeps at most one cleanup chain alive; `excludeChainIds: [job.chainId]` stops
the still-incomplete current chain from deduplicating the next run against itself. (`"incomplete"`
is not a real scope — `DeduplicationOptions.scope` is `"running" | "any"`.)

Changing retention or interval means letting the current chain finish and scheduling a new one
with the new input, or deleting the pending chain and re-creating it.

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
- The handler schedules the next run as a new chain, `intervalMs` out, carrying the same input.
- Deduplication keeps a single cleanup chain alive across repeated startup scheduling.
- User middleware (e.g. tracing) is invoked around the cleanup handler.
- Invalid input (negative / non-finite `retentionMs` or `intervalMs`) fails validation.
- Mounting the processors without `createCleanupJobTypes()` on the client is a type error.

Vacuum coverage is deferred with the vacuum step itself.
