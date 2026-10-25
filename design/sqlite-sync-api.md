# Sync client and attempt APIs for SQLite

Let a state adapter declare itself synchronous, and make every client method that touches state, the attempt handler's `complete`, and workerless `completeChain` return plain values instead of promises when it does. SQLite users can then call Queuert inside their driver's native synchronous transaction (`db.transaction(() => …)()` in better-sqlite3, drizzle and bun:sqlite; `BEGIN`/`COMMIT` with no `await` in node:sqlite), and the SQLite adapter drops `AsyncRwLock` for synchronous drivers.

## Problem

better-sqlite3, node:sqlite and bun:sqlite execute every statement synchronously, but Queuert's surface is asynchronous end to end: `SqliteStateProvider.executeSql` returns a promise, so every adapter method, `client.createChain`, and `complete` do too. That forces SQLite users into a shape no SQLite user writes otherwise:

- **No native transactions.** `db.transaction(fn)` in better-sqlite3, drizzle's better-sqlite3 driver and bun:sqlite rejects a callback that returns a promise. Every SQLite example therefore hand-rolls `db.exec("BEGIN")` / `COMMIT` / `ROLLBACK` around `await client.createChain(...)` and `await complete(...)`, and the drizzle example bypasses drizzle's transaction API entirely.
- **A lock the user has to carry.** Because the user's transaction spans `await`s, the worker's autocommit statements (acquire, heartbeat, reclaim, failure reschedule) could run on the same connection inside it. The provider serializes everything through `AsyncRwLock`, and user code has to take the same lock around its own transactions, and even around plain reads (`examples/state-sqlite-better-sqlite3/src/index.ts`). Forgetting it silently merges a worker statement into the user's transaction.
- **Fake asynchrony.** The promise wraps work that already finished; it buys nothing but the interleaving hazard above.

The TODO epic "SQLite production-readiness" already lists "Get rid of `createAsyncRwLock()`". A synchronous transaction cannot be interleaved by anything else on the same thread, so with sync drivers the lock has nothing left to protect.

## Mode

A state adapter has a `mode`: `"async"` (every adapter today) or `"sync"`. It is a third type parameter with an `"async"` default and a literal runtime field:

```ts
type StateAdapterMode = "sync" | "async";

type StateAdapter<TTxContext, TJobId, TMode extends StateAdapterMode = "async"> = {
  mode: TMode;
  withTransaction: <T>(
    fn: (txCtx: TTxContext) => TMode extends "sync" ? T : Promise<T>,
  ) => StateResult<TMode, T>;
  getChains: (params: …) => StateResult<TMode, (StateChain | undefined)[]>;
  // … every data method the same way
  close: () => StateResult<TMode, void>;
};

type StateResult<TMode, T> = TMode extends "sync" ? T : Promise<T>;
```

A sync adapter returns plain values from every data method, including the autocommit ones the worker calls (`startJobAttempt`, `extendJobAttempt`, `reclaimExpiredJobAttempt`, `rescheduleJobs` without `txCtx`). `close` follows the mode too. `mode` is fixed at construction and never changes.

Adding the parameter with a default leaves `StateAdapter<TTxContext, TJobId>` meaning what it means today, so the PostgreSQL adapter, the in-process adapter and custom adapters compile unchanged. The runtime field is required, because core has to pick a driver before the first statement runs (see below). Custom adapters gain it as a breaking change, or core treats a missing `mode` as `"async"`; see the open questions.

## Client surface

The return type of every client method that reads or writes state follows the adapter's mode, via `StateResult<GetStateAdapterMode<TStateAdapter>, …>`:

- Writes: `createChain`, `createChains`, `deleteChain`, `deleteChains`, `rescheduleJob`, `rescheduleJobs`.
- Workerless completion: `completeChain`. In sync mode its `handler`, the `completeJob` callback and `complete` are all synchronous, and the handler's return value is returned directly.
- Reads: `getChain`, `getChains`, `getJob`, `getJobs`, `getJobBlockers`, `listChains`, `listJobs`, `listChainJobs`, `listBlockedJobs`, `listChainTypeNames`, `listJobTypeNames`, `countByChainTypeNames`, `countByJobTypeNames`.

Stay async in both modes: `createClient`, `awaitChain` (it waits on notifications), `close`, and the whole worker API.

`withTransactionHooks` follows its callback, like `withSavepoint`: an async callback gets a promise that settles once the hooks flush after COMMIT, as today, and a synchronous callback gets its value back directly, with the hooks flushed synchronously after the synchronous COMMIT. A synchronous callback requires every hook to flush synchronously; a hook whose flush returns a promise throws. The built-in hooks are all synchronous: the notify hooks start the adapter's publish without awaiting it, which changes nothing observable because publish errors were already swallowed and workers fall back to polling.

```ts
const stateAdapter = createSyncSqliteStateAdapter({
  stateProvider: createBetterSqlite3SyncProvider({ db }),
});
stateAdapter.migrateToLatest();

const chain = withTransactionHooks((transactionHooks) =>
  db.transaction(() => {
    const user = insertUser.get("Alice", "alice@example.com") as { id: number };
    return client.createChain({
      db,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  })(),
);
```

Errors follow the mode as well: in sync mode a misuse error, a validation error, or an ownership error from `complete` is thrown synchronously, so it propagates out of `db.transaction` and rolls it back. In async mode every error is a rejection, as it is today, including errors that are detected before the first statement.

## Attempt handler

The handler stays `async`. It does its work outside any transaction, and `complete` follows the adapter's mode:

```ts
attemptHandler: async ({ job, complete }) => {
  const user = selectUser.get(job.input.userId);
  await sendEmail(user);
  return withTransactionHooks((transactionHooks) =>
    db.transaction(() =>
      complete({ db, transactionHooks, output: { sentAt: new Date().toISOString() } }),
    )(),
  );
},
```

`AttemptComplete` returns `StateResult<…>` instead of `Promise<…>`. Nothing else about `complete` changes: fenced writes, the at-most-once rule per `transactionHooks`, and the "counts once its hooks flush" rule all hold. The loss path (`readLossError`) reads the job through the same driver, so it is synchronous too.

The handler's own return type stays `Promise<…>`. A sync handler would let the worker skip one microtask, and nothing else.

## Implementation: one code path, two drivers

The core operations in `implementation.ts` (`createChains`, `completeChain`, `continueChain`, `rescheduleJobs`), the client method bodies, `createComplete` and the workerless `completeJob` are rewritten as generator functions. Each `yield` hands over the value an adapter method returned. A small internal driver runs a generator in a given mode:

- **sync**: feeds each yielded value straight back. A yielded thenable is a programmer error, for example an `async` callback passed to `completeChain` in sync mode or an adapter that lies about its mode. The driver throws a plain `Error` that names the call instead of silently returning a promise into a synchronous transaction.
- **async**: awaits each yielded value, and returns a promise that rejects on any throw, including one before the first `yield`.

The client picks the driver from `stateAdapter.mode` once, at `createClient`. Nothing is duplicated: both modes run the same generator, so every behavior the existing suites pin down applies to both.

The PostgreSQL adapter and the in-process adapter are untouched: they return promises, and the async driver awaits them. Only adapters that want to offer sync mode write their internals as generators. The SQLite adapter's methods are rewritten that way over `executeSql`, which is about 40 `await` sites in `state-adapter.sqlite.ts`, and it is driven in the provider's mode.

`wrapStateAdapterWithLogging` keeps the mode: it calls the method, reports a synchronous throw, and attaches its rejection handler only when the result is a thenable.

Generators add an allocation per operation. That is noise next to a SQLite statement, but the `processing-capacity` benchmark on SQLite should confirm it before merge.

## SQLite provider and factories

`SqliteStateProvider<TTxContext, TMode>` takes the mode as a type parameter, defaulting to `"async"`. In sync mode `withTransaction`, `executeSql` and the optional `close` return results directly. The provider carries no runtime `mode` field: the factory decides.

The mode is chosen by name, not inferred, because a reader of `createSqliteStateAdapter({ stateProvider })` could not tell whether to `await` it:

- `createSyncSqliteStateAdapter({ stateProvider })` takes a sync provider and returns the adapter directly. Its `migrateToLatest`, `truncate` and `close` are synchronous too.
- `createAsyncSqliteStateAdapter({ stateProvider })` takes an async provider and resolves to an async adapter, as before. It serves async drivers (libsql, bun's `SQL`, prisma, knex, kysely), and those keep `AsyncRwLock`.

An async provider passed to the sync factory is a type error. A sync provider passed to the async factory type-checks and works, just without sync mode.

SQLite and PostgreSQL do not share a lifecycle: SQLite's migration store takes no migration lock, so with a sync provider the shared migrator runs synchronously. PostgreSQL's migrator waits on a lease and stays asynchronous. `StateAdapter.close` follows the mode for every adapter.

A sync provider takes no lock. Instead it guards the one hazard a sync driver still has: a caller holding a raw `BEGIN` across an `await`. An autocommit statement (no `txCtx`) that finds the connection already inside a transaction, which `isTransaction({ db })` reports without a query, throws rather than joining someone else's transaction. The worker logs that throw as a state adapter error, and the user gets a clear signal instead of a silently merged write.

Built-in test providers (`state-provider.better-sqlite3.ts`, `state-provider.node-sqlite.ts`) get sync variants. The sync examples (`state-sqlite-better-sqlite3`, `state-sqlite-node-sqlite`, `state-sqlite-bun-sqlite`, `state-sqlite-drizzle`) switch to sync providers and native transactions and drop the lock. The async examples stay as they are.

## Transaction hooks

`transactionHooks.withSavepoint(fn)` always returns a promise, so it cannot be used inside a synchronous transaction. It gains a synchronous result when `fn` returns a non-thenable. This pairs with better-sqlite3's nested `db.transaction`, which opens a savepoint. `createSavepoint()` is already synchronous and needs no change.

## Testing

The client suites and the state adapter conformance are written once, mode-agnostically, and run against every adapter in both modes: in-process async and sync, SQLite (better-sqlite3) async and sync, node:sqlite sync conformance, and PostgreSQL async.

- **Single-expression transaction bodies** are plain arrows, `withTransaction((txCtx, transactionHooks) => client.createChain({ ... }))`: they return a value in sync mode and a promise in async mode, and the fixture's `withTransaction` runs them inside the adapter's own transaction.
- **Multi-step transaction bodies** are generators, `withTransactionOperation(function* (txCtx, transactionHooks) { const chain = yield* unwrap(client.createChain(...)); ... })`, driven in the adapter's mode. Conformance cases use `transaction(stateAdapter, ...)` and `transactionOperation(stateAdapter, ...)` the same way.
- **User callbacks with several dependent steps** (a workerless `completeChain` handler that continues and then completes) wrap their body in `runInMode(function* () { ... })`, which returns a value or a promise in the adapter's mode, so the callback itself stays a plain function.
- **Expected failures** are asserted with `expect(async () => client.x(...)).rejects`, which works whether the call throws synchronously or rejects, or inside a generator with `yield* expectFailure(() => client.x(...), Matcher)`.
- **Cases that need a transaction held open across an await** (lock contention between two transactions, a `complete` still in flight, a heartbeat landing mid-transaction) skip in sync mode via `asyncOnly(stateAdapter, expect)` or `skip(...)`; they cannot apply to a synchronous transaction.

The promise-function-async lint rule is off for the suites, conformance and spec helpers: mode-agnostic callbacks look like promise-returning functions to it, and its autofix would add `async` and break sync mode.

`syncModeTestSuite` covers what the shared suites cannot: results are not thenables, calls inside a driver's native `db.transaction`, and the autocommit guard.

## Docs

- `sqlite-internals.md`: replace the AsyncRwLock section with sync and async modes and the autocommit guard. The lock remains only for async providers.
- `custom-adapters.md` and `adapters.mdx`: the `mode` field, `StateResult`, and how to write a sync adapter.
- `job-processing.mdx`: `complete` inside a native synchronous transaction.
- TSDoc on `StateAdapter`, `SqliteSyncStateProvider`, `AttemptComplete`, `Client` methods, and `withSavepoint`.
- `code-style.md`: add `sync`/`async` mode to the domain vocabulary, and `createAsyncRwLock` stays in the exports table for async providers only.

## Open questions

1. **Required `mode` on custom adapters.** Requiring it is cleaner and makes the driver choice explicit. Treating a missing `mode` as `"async"` avoids a break for third-party adapters. Lean: required, since this is pre-1.0 and the change lands in a `major` changeset anyway.
2. **Name of the result helper.** `StateResult<TMode, T>`, or something more specific (`StateAdapterResult`). It shows up in hover types on every client method, so it needs to read well.
3. **In-process adapter in sync mode.** An in-memory adapter can be synchronous, which would let core run the sync suite without SQLite. It would also mean maintaining a second transaction story in that adapter. Lean: not in v1; the sync suite runs from `@queuert/sqlite`.
4. **drizzle's transaction context.** drizzle's `tx` does not expose the underlying better-sqlite3 handle in its public type. Either the drizzle example passes the outer `db` as the transaction context (correct, because better-sqlite3 has one connection and `inTransaction` is per connection), or the provider accepts a drizzle `tx`. Lean: the outer `db`, documented in the example.
5. **Multiple connections.** A sync provider with a separate reader connection, or several processes on one WAL file, is out of scope here. It belongs to the existing "promote transactions via a sentinel table" task.
