# Built-in cleanup

Ship ready-made cleanup as a slice plus two scheduling helpers, so users delete completed chains
without hand-writing the cursor-paginate-delete-reschedule loop, and manage recurring cleanup
schedules — including per-type retention — without touching the raw `createChain` /
deduplication machinery.

## Problem

The cleanup guide (`docs/src/content/docs/guides/cleanup.md`) walks users through a ~60-line
attempt handler that every production deployment needs. The loop is identical across users:
paginate completed chains, delete in batches, reschedule the next run. The knobs — retention,
interval, and which types to sweep — are the only things that vary.

An earlier draft exported the slice but left scheduling to the user, who then had to write the
magic job-type string, hand-roll `deduplication`, and — because retention/interval rode in the
chain input — perform a `listChains → deleteChain → createChain` dance by hand to change a single
number. That leaks internals and is easy to get wrong. It also offered no per-type retention: it
deleted _all_ completed chains past one global cutoff.

## Solution

Four exports, from a dedicated `queuert/cleanup` entrypoint:

1. **`createCleanupJobTypes()`** — job-type registry, mounted on the client via array merge.
2. **`createCleanupProcessors({ client, batchSize?, attemptMiddleware? })`** — the processor
   slice, mounted on the worker via array merge. **Policy-free**: execution mechanics only.
3. **`scheduleCleanup({ ...txCtx, transactionHooks, client, name, typeNames?, retentionMs, intervalMs })`**
   — upsert a named, recurring cleanup schedule.
4. **`unscheduleCleanup({ ...txCtx, transactionHooks, client, name })`** — cancel one schedule.

Policy (what to sweep, how long to keep, how often) lives on the **schedule**, addressed by `name`;
mechanics (batch size, middleware) live on the **processor**. `cleanupJobTypeName`,
`CleanupJobInput`, and `CleanupJobTypeDefinitions` are **not** exported — the helpers absorb every
place a user would have needed them.

### Job types factory

```ts
export function createCleanupJobTypes() {
  return createJobTypes<{
    "__queuert/cleanup": { entry: true; input: CleanupJobInput; output: null };
  }>({
    /* validate the input carries a valid name/typeNames/retentionMs/intervalMs */
  });
}
```

`createJobTypes` (not `defineJobTypes`) so the built-in supplies its own runtime validation and
merges cleanly with both no-op and validated user registries. The input type is internal.

### Processor factory — policy-free

```ts
createCleanupProcessors({ client, batchSize?, attemptMiddleware? });
```

- **`client`** — required; carries the `TStateAdapter` generic the middleware types check against,
  and is the same superset check that catches a user who mounted the processors but forgot
  `createCleanupJobTypes()` on the client.
- **`batchSize`** — chains listed and deleted per batch (default 100).
- **`attemptMiddleware`** — this slice's middleware chain, so the built-in can satisfy a worker
  configured with `requiredAttemptMiddleware` (matched by reference identity).

No retention/interval/typeNames here — those are per-schedule, not per-worker.

### Named schedules

A schedule is identified by a required user `name`, realized as a chain with identity key
`__queuert/cleanup:${name}`, `scope: "running"` — at most one running chain per name. `name` is
**required**, with no default: it is the identity of a persisted schedule that `scheduleCleanup`
upserts and `unscheduleCleanup` deletes by, so a silent default would let two unrelated call sites
(an app boot, a library that also schedules cleanup) address the same schedule and silently
clobber each other's config. The chain input carries the schedule's config:
`{ name, typeNames?, retentionMs, intervalMs }`. Multiple names give multiple independent
schedules, which is how per-type retention is expressed:

```ts
await scheduleCleanup({
  ...txCtx,
  transactionHooks,
  client,
  name: "short",
  typeNames: ["email.send"],
  retentionMs: DAY,
  intervalMs: HOUR,
});
await scheduleCleanup({
  ...txCtx,
  transactionHooks,
  client,
  name: "long",
  typeNames: ["report.build"],
  retentionMs: 30 * DAY,
  intervalMs: 6 * HOUR,
});
```

`typeNames` is typed `readonly JobTypeEntryNames<TClientDefs>[]` — inferred from the client, so it
autocompletes to the client's own entry types and rejects anything else at compile time, with no
runtime registry introspection (which the no-op `defineJobTypes` path could not provide anyway).
Omitting `typeNames` sweeps all completed chains past the cutoff.

### `scheduleCleanup` is an upsert — read, compare, swap

`scheduleCleanup` runs at every application boot and must be idempotent _without_ resetting the
recurrence timer — a service redeploying faster than `intervalMs` must not push the next run out
forever. So it reads before writing, inside the caller's transaction:

```ts
const identity = { key: `__queuert/cleanup:${name}`, scope: "running" } as const;

const existing = await client.getChain({ ...txCtx, identity, lock: true });
if (!existing) {
  await client.createChain({ ...txCtx, transactionHooks, identity /* new schedule */ });
} else if (configDiffers(existing.input, next)) {
  await client.deleteChain({ ...txCtx, transactionHooks, id: existing.id });
  await client.createChain({ ...txCtx, transactionHooks, identity /* new schedule */ });
}
// config unchanged → no-op: no delete, no timer reset
```

This leans on both primitives: `getChain({ identity })` to find the running chain for the name
([chain-identity.md](chain-identity.md)), and `lock` to serialize the compare-and-swap against a
concurrent scheduler (shipped). The absent-row race (two boots, neither sees a chain, both create)
is caught by the `running`-scope unique index — `lock` alone cannot cover it. Delete and create
happen in the caller's single transaction, so there is never a window with zero or two running
chains.

### Deleting a running schedule is safe

When `configDiffers` and the running chain is currently _executing_, `deleteChain` removes it
mid-attempt. The in-flight handler's next `execute`/`complete` fails attempt verification with
`JobNotFoundError`; the worker logs one `workerError` and drops the job — **no retry, no crash**,
and crucially the handler never reaches `complete`, so it does **not** self-reschedule. Batches
already deleted are committed and harmless (cleanup is idempotent; the replacement resumes from
the oldest remaining chain). The only artifact is a single benign error log, only when config
actually changes while a run happens to be executing — rare, and worth a docs note. This is also
what makes `unscheduleCleanup` reliably immediate: deleting the chain kills its self-reschedule
for free, with no tombstone or completion-time re-check.

### The handler

```ts
"__queuert/cleanup": {
  attemptHandler: async ({ signal, job, execute, complete }) => {
    const { name, typeNames, retentionMs, intervalMs } = job.input;
    const cutoff = new Date(Date.now() - retentionMs);
    let cursor;
    do {
      const page = await client.listChains({
        status: "completed", orderBy: "completedAt", orderDirection: "asc",
        independent: true, to: cutoff, limit: batchSize,
        ...(typeNames ? { typeName: typeNames } : {}),
        ...(cursor ? { cursor } : {}),
      });
      const ids = page.items.filter((c) => c.id !== job.chainId).map((c) => c.id);
      if (ids.length) await execute(({ transactionHooks, ...tx }) =>
        client.deleteChains({ ...tx, transactionHooks, ids }));
      cursor = page.nextCursor;
    } while (cursor && !signal.aborted);

    return finalize(async ({ complete, transactionHooks, ...tx }) => {
      const completedJob = await complete(null);
      await client.createChain({ ...tx, transactionHooks,
        typeName: "__queuert/cleanup", input: job.input,
        schedule: { afterMs: intervalMs },
        identity: { key: `__queuert/cleanup:${name}`, scope: "running" } });
      return completedJob;
    });
  },
}
```

Each batch deletes in its own `execute` transaction (bounded lock scope, attempt verified per
batch). The scan drops out between batches on `signal.aborted`; deletion is idempotent, so the
next run resumes from the oldest remaining chain. The self-reschedule creates a **new independent
chain** (not `continueWith`, so history does not grow), forwarding `job.input` unchanged so config
survives run-to-run. It runs after `complete()` inside `finalize`, so the current chain is already
complete when the next one is created — otherwise the still-running chain would collide with its own
`running`-scope identity (see [chain-identity.md](chain-identity.md)).

### User setup

```ts
import { createCleanupJobTypes, createCleanupProcessors, scheduleCleanup } from "queuert/cleanup";

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes: [createCleanupJobTypes(), myJobTypes],
});

const worker = await createInProcessWorker({
  client,
  processors: [createCleanupProcessors({ client }), myProcessors],
});

await withTransactionHooks((transactionHooks) =>
  sql.begin((txSql) =>
    scheduleCleanup({
      sql: txSql,
      transactionHooks,
      client,
      name: "main",
      retentionMs: 7 * DAY,
      intervalMs: HOUR,
    }),
  ),
);
```

Array merge for the two slices, one transactional call to install the schedule. Rolling deploys
compose: deploy N+1 calls `scheduleCleanup({ name: "b" })` and `unscheduleCleanup({ name: "a" })`.

### Vacuum

Deferred, unchanged from the prior design: `vacuum()` lives on the concrete PostgreSQL/SQLite
adapters, not on the core `StateAdapter` interface, so a core-exported handler cannot call it. The
guide tells users to vacuum on their own cadence. Resolving it later means an optional
`vacuum?: () => Promise<void>` hop or hoisting `vacuum` onto the interface.

### Export location

A dedicated `queuert/cleanup` subpath (matching the existing `./conformance`, `./testing`
precedent) signals an opt-in batteries-included module and keeps the core namespace lean.

## Dependencies

Requires [chain-identity.md](chain-identity.md), which composes with the shipped locked reads into
`getChain({ identity, lock: true })` and supplies the post-completion scheduling the handler's
self-reschedule depends on.

## Docs

The cleanup guide becomes: mount the slice, `scheduleCleanup` / `unscheduleCleanup`, per-type
retention via names, and "write your own" for archival/metrics/alerting. The magic string,
manual deduplication, and the reconfigure dance all disappear from it.

## Tests

- Completed chains older than retention are deleted across batches; younger ones preserved.
- `typeNames` scopes deletion to the given entry types; omitting it sweeps all.
- The cleanup chain never deletes itself; the handler self-reschedules a new chain, `intervalMs`
  out, carrying the same input.
- `scheduleCleanup` is a no-op when config is unchanged (no delete, timer not reset).
- `scheduleCleanup` with changed config replaces the schedule; concurrent boots converge to one
  chain (dedup + `lock`).
- Deleting a running schedule surfaces one benign `workerError` and no reschedule.
- `unscheduleCleanup` removes a schedule and stops its recurrence.
- Multiple names run independent schedules with independent retention.
- Omitting `name` is a type error (it is required, no default).
- User middleware is invoked around the handler.
- Invalid input (negative / non-finite `retentionMs` / `intervalMs`) fails validation.
- Mounting the processors without `createCleanupJobTypes()` on the client is a type error;
  `typeNames` outside the client's entry types is a type error.
