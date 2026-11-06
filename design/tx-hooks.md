# Tx hooks

Rework transaction hooks into `txHooks`. The rework has four parts:

- **Sync and async variants.** Each instance has a fixed mode, so synchronous transactions (better-sqlite3, `node:sqlite`, `bun:sqlite`) can use the hooks without an `await`.
- **`txHooks.perTry(fn)`.** Gives drivers that rerun the transaction callback, and retry loops placed inside the wrapper, a clean hook state per try. This is what REPEATABLE READ and SERIALIZABLE retries on PostgreSQL and the MongoDB `withTransaction` loop need.
- **Disposable manual handles.** A handle that was neither flushed nor discarded is discarded when it goes out of scope.
- **A library-wide rename.** `transactionHooks` becomes `txHooks`, to match `txCtx`.

The nested callback stays the primary API.

## Problem

`withTransactionHooks` creates one instance, runs the callback, flushes on success and discards on error. This has three gaps:

- **A rerun reuses the hooks.** `session.withTransaction` and Mongoose's `connection.transaction` rerun the callback after a transient error. So does a user retry loop for 40001/40P01 placed inside `withTransactionHooks`. Every try then shares one instance:
  - The second try's `complete` throws `complete already succeeded with these transactionHooks`.
  - Events that the rolled-back try buffered (`createChain` notifications and observability) flush after the successful try, for rows that were never committed.
- **No synchronous form.** The callback must return a promise and the flush is always awaited, so a synchronous transaction cannot be wrapped from a synchronous caller. `withSavepoint` always returns a promise, so it cannot pair with better-sqlite3's nested `db.transaction`, which opens a savepoint.
- **The manual handle leaks when misused.** Forgetting `flush()` drops `complete`'s result: the worker treats the attempt as lost and reclaims it as a failed attempt. Forgetting `discard()` leaves the buffered state behind with nothing to clean it up.

## Design

### Two variants, mode fixed at creation

|               | async                                                  | sync                                     |
| ------------- | ------------------------------------------------------ | ---------------------------------------- |
| wrapper       | `withTxHooks(cb: (txHooks) => Promise<T>): Promise<T>` | `withTxHooksSync(cb: (txHooks) => T): T` |
| handle        | `createTxHooks(): TxHooksHandle`                       | `createTxHooksSync(): TxHooksSyncHandle` |
| instance type | `TxHooks`                                              | `TxHooksSync`                            |

The mode is a property of the instance and is never inferred from a callback's return value:

- **Inferring the mode would hide a missing `return`.** Take a block-bodied callback with no `return`, such as `(txHooks) => { sql.begin(...) }`. It returns `undefined`, so the hooks would flush synchronously while the transaction is still open. `withTxHooks` requires a promise in its type, so this does not compile.
- **`withTxHooksSync` rejects a thenable result.** Its type excludes `PromiseLike` results. At runtime, a thenable result is discarded and the wrapper throws a plain `Error` that names `withTxHooks`.
- **`withSavepoint` follows the instance.** On `TxHooks` it returns `Promise<T>`. On `TxHooksSync` it returns `T`, and an `fn` that returns a thenable throws.
- **An async instance can still wrap a synchronous transaction**, as in `await withTxHooks(async (txHooks) => db.transaction(() => ...)())`. Only a synchronous caller needs the sync variant.

Client methods accept either instance type. The shared operations (`set`, `getOrInsert`, `get`, `has`, `delete`, `createSavepoint`, `perTry`) are identical in both modes.

### Hooks in sync mode

`HookDefinition` keeps `flush` and `discard` as `(state) => void | Promise<void>`. In sync mode, every hook's flush (or discard) runs. If any of them returns a thenable, that promise's rejection is silenced and the call throws a plain `Error` after all hooks have run. An error a hook throws synchronously is rethrown first. Custom async hooks are therefore an error in sync mode, never a silent loss.

The built-in hooks must work in both modes:

- **`complete`'s slot**: already synchronous.
- **Observability callbacks**: become `() => void`. None of the built-in callbacks is async.
- **Notify hooks** (`notifyJobsScheduled`, `notifyChainCompleted`, `notifyJobAttemptLost`): their flush starts the adapter's publish without awaiting it. Publish errors are already swallowed and workers fall back to polling, so the only change is timing: `await withTxHooks(...)` now resolves before the publish has finished, in both modes.

### `txHooks.perTry(fn)`

`perTry` wraps a transaction callback that a driver may call more than once. Each call after the first undoes what the previous try buffered, then runs `fn`:

```ts
await withTxHooks((txHooks) =>
  session.withTransaction(
    txHooks.perTry(async () => {
      await orders.insertOne(order, { session });
      await client.createChain({ session, txHooks, typeName: "send-receipt", input });
    }),
  ),
);
```

**Undo at re-entry, not on failure.** A try can fail after `fn` has returned:

- PostgreSQL SERIALIZABLE raises 40001 at COMMIT.
- MongoDB's commit fails with `TransientTransactionError`.

The driver catches these failures inside its own loop, so the wrapper never sees them. The only reliable sign that a try failed is the next call. MongoDB retries `UnknownTransactionCommitResult` by retrying the commit alone, without rerunning the callback, so the state correctly stays with that try.

**A savepoint rolled back at re-entry.** Each call rolls back the savepoint the previous call created (if any), then creates a new one before running `fn`. Reusing the savepoint machinery gives:

- **State from before the first try survives**: rollback goes back to the mark, not to empty.
- **Each hook's `checkpoint` decides what is undone.**
  - `complete`'s slot goes back to `write = null`, so the retried `complete` may succeed.
  - Rollback observability callbacks of the failed try fire.
  - Notify hooks first registered during the try are discarded.
- **It works the same in both modes**, because savepoint rollback is synchronous. The wrapped function returns what `fn` returns.
- **Nesting works**: `withSavepoint` inside a try, and a `perTry` inside a `perTry`, nest like savepoints.
- **The final outcome needs no extra step.** The enclosing `withTxHooks` flushes the last try's state when the driver succeeds and discards it when the driver gives up.

A call while the previous call's `fn` is still running throws a plain `Error`. No driver runs one transaction callback concurrently.

`perTry` also covers a user retry loop placed inside the wrapper: `withTxHooks((txHooks) => retry(txHooks.perTry(() => sql.begin(...))))`. A loop placed outside, `retry(() => withTxHooks(...))`, needs nothing, because every try gets its own instance.

Rejected alternatives:

- **A public `reset()`.** Called mid-try, it drops the notifications and `complete`'s result for writes that are about to commit. It also wipes state from before the first try.
- **Detecting a new try by `txCtx` identity.** `session.withTransaction` reuses its session across retries, and `pg` keeps the same `PoolClient`.
- **A fresh instance per try, passed as an argument.** Two hooks objects end up in scope, and capturing the outer one brings the bug back.

### Knex: a rollback that resolves

`withTxHooks` and `perTry` treat a callback that resolves (or returns) as committed. Knex breaks this. `doNotRejectOnRollback` defaults to `true`, so a bare `trx.rollback()` inside `knex.transaction(cb)` resolves the outer promise with `undefined` instead of rejecting it (knex 3.3, `lib/execution/transaction.js`). The hooks then flush for a rolled-back transaction:

- `complete` is counted as completed, but nothing was written. The job stays `running` until its worker is next idle and reclaims it as a failed attempt.
- `createChain` notifications and observability events are emitted for rows that do not exist.

The hooks cannot detect the rollback: the promise resolves with `undefined` either way, and `trx.isCompleted()` is true after a commit too. No new API is added. The docs teach knex users to pass `{ doNotRejectOnRollback: false }` to every `knex.transaction` that uses tx hooks, so a bare `trx.rollback()` rejects (`Transaction rejected with non-error: undefined`) and the hooks discard:

```ts
await withTxHooks((txHooks) =>
  knex.transaction(
    async (trx) => {
      await client.createChain({ trx, txHooks, typeName: "send-email", input });
    },
    { doNotRejectOnRollback: false },
  ),
);
```

Nested `trx.transaction(cb)` savepoints force the default back to `true` unless the option is passed again, so a nested savepoint paired with `withSavepoint` needs `{ doNotRejectOnRollback: false }` too. Rolling back by throwing, or with `trx.rollback(error)` and an `Error`, rejects at either setting.

The knex examples pass the option. A test pins knex's behavior so the docs stay true. The other clients used in the examples roll back by throwing: Drizzle's `tx.rollback()` throws, and postgres.js, Kysely, Prisma, better-sqlite3 and Bun SQL have no callback-scoped rollback that resolves.

### Disposable handles

`TxHooksHandle` gains `[Symbol.asyncDispose]` and `TxHooksSyncHandle` gains `[Symbol.dispose]`. Disposal discards the hooks unless `flush()` or `discard()` already ran:

```ts
await using handle = createTxHooks();
await sql.begin(async (tx) => client.createChain({ tx, txHooks: handle.txHooks, ... }));
await handle.flush();
```

A forgotten `flush()` now ends in a discard instead of state left behind. Node 24, the minimum supported version, runs `using` and `await using` natively.

### Rename

| Before                          | After                                 |
| ------------------------------- | ------------------------------------- |
| `withTransactionHooks`          | `withTxHooks` / `withTxHooksSync`     |
| `createTransactionHooks`        | `createTxHooks` / `createTxHooksSync` |
| `TransactionHooks`              | `TxHooks` / `TxHooksSync`             |
| `TransactionHooksHandle`        | `TxHooksHandle` / `TxHooksSyncHandle` |
| `TransactionHooksSavepoint`     | `TxHooksSavepoint`                    |
| `requireTransactionHooks`       | `requireTxHooks`                      |
| option field `transactionHooks` | `txHooks`                             |

The rename applies everywhere: packages, error messages, TSDoc, docs, examples, test suites and design documents. `HookDefinition` keeps its name. In docs prose the concept is "tx hooks", and the guide moves from `guides/transaction-hooks` to `guides/tx-hooks`.

The misuse error in `complete` names the fix: `complete already succeeded with these txHooks; wrap a callback the driver reruns in txHooks.perTry, or give a retried transaction its own withTxHooks`.

### Vocabulary

Add to Code Style's Domain Vocabulary:

- **`try`**: one run of a transaction callback by a driver or loop that may rerun it. It is never called an "attempt", which is a job's.

## API

- `withTxHooks`, `withTxHooksSync`, `createTxHooks`, `createTxHooksSync`: new names for the existing functions, plus the sync variants.
- `TxHooks.perTry(fn)`: new.
- `TxHooksSync.withSavepoint(fn)`: returns `T`.
- `TxHooksHandle[Symbol.asyncDispose]` and `TxHooksSyncHandle[Symbol.dispose]`: new.
- Every client, attempt and workerless method takes `txHooks` instead of `transactionHooks`.
- Notify hooks no longer await the publish.

This is a breaking change (`major`) for `queuert` and every adapter package whose public types or docs mention the field.

## Tests

- **Sync variant.**
  - Flushes before returning.
  - Discards on throw.
  - A thenable result throws.
  - A hook returning a promise throws after all hooks ran.
  - Sync `withSavepoint` rolls back on throw.
- **Async variant.** The existing `transaction-hooks.spec.ts` cases, renamed.
- **`perTry`, under both variants**, with a driver stub that reruns the callback:
  - Try 1's `complete` succeeds, then its "commit" fails; try 2's `complete` succeeds and only try 2's events flush.
  - Rollback observability callbacks fire for the failed try.
  - State buffered before the first try survives.
  - A failure after `fn` returned is undone on re-entry.
  - An overlapping call throws.
  - `withSavepoint` works inside a try.
- **Disposal.** Dispose without `flush` runs `discard`; dispose after `flush` is a no-op.
- **Knex.**
  - A bare `trx.rollback()` resolves `knex.transaction`.
  - `{ doNotRejectOnRollback: false }` makes it reject.
  - A nested `trx.transaction(cb)` needs the option again.
  - With the option, `withTxHooks` around a bare `trx.rollback()` flushes nothing.
  - Lives in the knex examples' specs.
- **Notify.** `withTxHooks` resolves without waiting for a slow `notifyJobsScheduled`, and the publish still happens.

## Docs

- `guides/tx-hooks.mdx` (renamed):
  - sync and async variants;
  - a "Drivers that rerun the callback" section for `perTry`;
  - the "resolved means committed" contract, and `{ doNotRejectOnRollback: false }` for knex, nested savepoints included;
  - `await using` on the manual handle.
- `how-it-works/job-processing.mdx`: the "counts once its hooks flush" rule names `perTry` next to `withSavepoint`.
- Every page and example that uses the old names.

## Related designs

- `design/pg-isolation-levels.md`: callers retry 40001/40P01 with fresh hooks per try. This design supplies `perTry` for loops inside the wrapper.
- `design/mongodb-adapter.md`: `withMongoTransaction` becomes `withTxHooks` + `session.withTransaction` + `perTry`.
