# Execute transaction

A third transaction primitive for the attempt handler — alongside `prepare` and `complete` —
that opens a guarded, independently committed transaction mid-attempt.

## Problem

Long-running staged handlers (cleanup, unbounded aggregation) need to perform transactional
work in bounded batches between `prepare` and `complete`. Today, the handler has no way to
open an intermediate transaction through the framework. The alternatives are:

- One giant transaction spanning the entire handler (defeats batching, long lock, rollback bomb).
- Smuggling a raw connection around the framework (defeats the framework — no lease guard, no
  middleware, no transaction hooks).

## Solution

Add `execute` to the attempt handler parameter object. Each call opens a fresh transaction,
verifies the job lease is still held, runs the user callback, commits, and flushes hooks.

### Type signature

```ts
export type AttemptExecute<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TExecuteCtx extends Record<string, unknown> = Record<string, unknown>,
> = <T>(
  executeCallback: (
    options: { transactionHooks: TransactionHooks } & GetStateAdapterTxContext<TStateAdapter> &
      TExecuteCtx,
  ) => T | Promise<T>,
) => Promise<Awaited<T>>;
```

Same callback shape as `complete`, minus `continueWith`. Returns whatever the callback returns.

### Middleware hook

```ts
wrapExecute?: <T>(
  opts: {
    job: RunningJob<TStateAdapter>;
    transactionHooks: TransactionHooks;
    next: (ctx: TExecuteCtx) => Promise<T>;
  } & GetStateAdapterTxContext<TStateAdapter>,
) => Promise<T>;
```

Same pattern as `wrapPrepare` / `wrapComplete`.

### Behavior

1. Opens a fresh transaction via `stateAdapter.withTransaction`.
2. Locks the job row and verifies `worker_id` + lease validity (same guard as
   `runInGuardedTransaction` used by lease renewal).
3. Creates fresh `TransactionHooks`.
4. Runs the user callback with `txCtx` + `transactionHooks` + middleware context.
5. Commits the transaction, flushes hooks.
6. If the guard fails → throws, aborting the attempt (worker lost the lease).

### Constraints

- Only valid after `prepare({ mode: "staged" })` — calling `execute` before prepare or in
  atomic mode is a runtime error (the lease renewal loop must be running).
- Only valid before `complete` — calling after complete is a runtime error.
- Each call is independent — no shared transaction state between `execute` calls.
- No lifecycle side effects — does not start/stop lease renewal, does not mark the job
  complete, does not trigger continuations.

### Usage — cleanup batches

```ts
attemptHandler: async ({ job, prepare, execute, complete }) => {
  await prepare({ mode: "staged" });

  const { retentionMs } = job.input;
  const cutoff = Date.now() - retentionMs;
  let cursor;
  let totalDeleted = 0;

  do {
    const batch = await execute(async ({ transactionHooks, ...txCtx }) => {
      const { chains, nextCursor } = await stateAdapter.getChains({
        ...txCtx,
        filter: { completedBefore: cutoff },
        cursor,
        limit: 100,
      });
      await stateAdapter.deleteChains({ ...txCtx, chainIds: chains.map((c) => c.id) });
      return { deleted: chains.length, nextCursor };
    });
    totalDeleted += batch.deleted;
    cursor = batch.nextCursor;
  } while (cursor);

  await execute(async (txCtx) => {
    await stateAdapter.vacuum(txCtx);
  });

  return complete(async () => ({ totalDeleted }));
};
```

### Usage — unbounded aggregation with checkpoints

```ts
attemptHandler: async ({ job, prepare, execute, listBlockers, complete }) => {
  await prepare({ mode: "staged" });

  let runningTotal = 0;
  let count = 0;

  for await (const blocker of listBlockers()) {
    runningTotal += blocker.output.value;
    count++;

    if (count % 1000 === 0) {
      await execute(async ({ ...txCtx }) => {
        await saveCheckpoint(txCtx, job.id, { runningTotal, count });
      });
    }
  }

  return complete(async () => ({ sum: runningTotal }));
};
```

## Relationship to other features

Prerequisite for `design/builtin-cleanup.md` (batched delete loop) and
`design/unbounded-blockers.md` (`listBlockers` with intermediate writes). Both designs assume
the handler can perform transactional work in bounded increments without holding a single
long-lived transaction.

## Tests

- `execute` runs callback in a committed transaction with valid `txCtx` and `transactionHooks`.
- Hooks flush after each `execute` call (not deferred to `complete`).
- Guard rejects when lease is expired — attempt aborts.
- Guard rejects when another worker has taken the job — attempt aborts.
- Calling `execute` before `prepare` throws.
- Calling `execute` in atomic mode throws.
- Calling `execute` after `complete` throws.
- Multiple sequential `execute` calls each get independent transactions.
- Middleware `wrapExecute` is invoked around each call.
- `execute` return value is forwarded to the caller.
