# Transaction hooks provider

Let a state provider supply the `transactionHooks` of a transaction it can recognize, so callers stop passing them to `complete` and the client's mutating methods. Queuert still never opens a transaction for the caller, and `complete` still requires an open one.

## Problem

Every mutating call carries two things that belong to one transaction: the transaction context and its `transactionHooks`. Callers create the hooks themselves, around their own transaction:

```ts
return withTransactionHooks(async (transactionHooks) =>
  db.transaction().execute(async (db) => complete({ db, transactionHooks, output })),
);
```

That pairing is the caller's job, and its rules are documented on `complete` (`attempt-handler.types.ts:96-121`, `:155`) but enforced only at runtime, or not at all:

- `withTransactionHooks` must wrap the transaction from outside, so the hooks flush after COMMIT.
- `complete` succeeds at most once per `transactionHooks`, so a loop that retries the transaction must open `withTransactionHooks` once per try (`attempt-handler.ts:105`).
- A `complete` that may be rolled back without rolling back the transaction must run in `transactionHooks.withSavepoint`, or the attempt counts as completed while the job stays `running`.

The examples call `withTransactionHooks` 294 times. Most calls are this same wrapper.

## Constraints

- **Queuert does not own transactions.** No `client.transaction(fn)` and no handler-level `transaction` helper. Transactions are opened by the caller's code or by the caller's state provider, as today.
- **`complete` and mutating methods keep requiring an open transaction.** `requireTxCtx` and `isTransaction` are unchanged. Hooks become implicit; the transaction does not become optional.
- **No `AsyncLocalStorage`.** Scope is not identity: a call inside a scope that passes a different transaction would attach to the wrong hooks. Core also stays runtime-agnostic.
- **Additive.** Existing providers, adapters and call sites keep compiling and behaving the same.

## Transaction hooks modes

A state provider declares one of two modes:

- **`explicit`** (default, today's behavior): callers pass `transactionHooks`; the provider knows nothing about them.
- **`implicit`**: the provider supplies the `transactionHooks` bound to a transaction context; callers must not pass them.

Add both words to the Domain Vocabulary in `code-style.md`, together with **bind**: hooks are _bound_ to a transaction, and a context with no hooks bound to it is _unbound_.

## Provider contract

`PgStateProvider` and `SqliteStateProvider` gain a mode type parameter, placed last with a default so existing providers are unaffected:

```ts
type TransactionHooksMode = "explicit" | "implicit";

type PgStateProvider<
  TTxContext extends BaseTxContext,
  TTransactionHooksMode extends TransactionHooksMode = "explicit",
> = {
  withTransaction: …;
  isTransaction: …;
  executeSql: …;
  close?: …;
} & (TTransactionHooksMode extends "implicit"
  ? { getTransactionHooks: (txCtx: TTxContext) => TransactionHooks | undefined }
  : { getTransactionHooks?: never });
```

At runtime the mode is the presence of `getTransactionHooks`. An implicit provider guarantees:

1. **Bound at the transaction level.** All calls with contexts of one transaction get the same `TransactionHooks`.
2. **Settled when the transaction ends.** The hooks flush after the transaction commits and are discarded after it rolls back. A bound transaction never ends without one of the two.
3. **Savepoints map to hooks savepoints.** A nested transaction or savepoint gets `createSavepoint()` on its parent's hooks: released with the savepoint, rolled back with it. Releasing a savepoint never flushes.
4. **Never shared.** Two transactions, concurrent or sequential, never get the same hooks.
5. **Every transaction from `withTransaction` is bound.** Core-internal and dashboard writes go through it (see below).
6. **Synchronous and query-free**, like `isTransaction`.
7. **`undefined` for an unbound context.** The provider does not throw or create hooks on a miss; core reports the error so the message is the same for every provider.

`getTransactionHooks` is only called on a context `isTransaction` accepted, so a provider never binds hooks to a transaction that already ended.

### Implementing it

Two ways, both owned by the caller's code or ORM:

- **Driver commit signal.** The provider binds lazily on the first lookup, keyed by the driver's transaction object, and settles the hooks from the driver's own commit and rollback signal. This works with any transaction the app opens. It is only correct if the signal really distinguishes commit from rollback (see Driver support).
- **App transaction wrapper.** The app's own transaction helper calls `createTransactionHooks()`, opens the transaction, binds the hooks to the driver's transaction object, flushes after commit and discards after rollback. `withTransaction` uses the same wrapper (rule 5). A transaction opened outside the wrapper is unbound, and core rejects it.

### Bookkeeping in user land

Core ships no binding helper. The provider keeps a `WeakMap` from the driver's transaction object to the hooks it created with `createTransactionHooks()`, and `getTransactionHooks` reads it:

```ts
const transactionHooksByTransaction = new WeakMap<Kysely<DB>, TransactionHooks>();

const transaction = async <T>(fn: (txCtx: { db: Kysely<DB> }) => Promise<T>) => {
  const { transactionHooks, flush, discard } = createTransactionHooks();
  const result = await db
    .transaction()
    .execute(async (txDb) => {
      transactionHooksByTransaction.set(txDb, transactionHooks);
      return fn({ db: txDb });
    })
    .catch(async (error: unknown) => {
      await discard();
      throw error;
    });
  await flush();
  return result;
};

const stateProvider: PgStateProvider<{ db: Kysely<DB> }, "implicit"> = {
  ...baseProvider,
  withTransaction: transaction,
  getTransactionHooks: (txCtx) => transactionHooksByTransaction.get(txCtx.db),
};
```

A failed COMMIT rejects `execute`, so the hooks are discarded and never left unsettled.

A savepoint stores `createSavepoint()` of its parent's hooks under the savepoint's own transaction object, and settles it with the database savepoint. This needs a driver whose savepoint is a distinct object, such as Kysely's `ControlledTransaction.savepoint()`:

```ts
const savepoint = async <T>({ db: parentDb }, fn) => {
  const hooksSavepoint = transactionHooksByTransaction.get(parentDb)!.createSavepoint();
  const txDb = await parentDb.savepoint(name).execute();
  transactionHooksByTransaction.set(txDb, hooksSavepoint.transactionHooks);
  const result = await fn({ db: txDb }).catch(async (error: unknown) => {
    await txDb.rollbackToSavepoint(name).execute();
    hooksSavepoint.rollback();
    throw error;
  });
  await txDb.releaseSavepoint(name).execute();
  hooksSavepoint.release();
  return result;
};
```

## State adapter

- `StateAdapter` gains a fourth type parameter, `TTransactionHooksMode extends TransactionHooksMode = "explicit"`, after `TWorkerId`. Because of the default, a constraint written as `StateAdapter<any, any, any>` means explicit and rejects an implicit adapter, so core's internal constraints are `StateAdapter<any, any, any, any>`. `createPgStateAdapter` and `createSqliteStateAdapter` infer the mode from the provider's declared type, so a provider written as an unannotated object literal needs an annotation. `PgStateAdapter` and `SqliteStateAdapter` take the mode as a last type parameter.
- `StateAdapter` gains an optional `getTransactionHooks?: TransactionHooksGetter<TTxContext, TTransactionHooksMode>`: a function when implicit, `undefined` when explicit. It is a property type, not an intersection like the provider's `TransactionHooksSource`; an intersection at the top of `StateAdapter` made TypeScript print adapters structurally in declaration emit (TS2883 in `showcase-slices`). Providers keep the intersection, which makes `getTransactionHooks` required when they declare `implicit`. The PostgreSQL and SQLite adapters forward it from the provider, as they forward `isTransaction`, through one cast where the generic mode meets the literal.
- The in-process state adapter stays `explicit`.
- `GetStateAdapterTransactionHooksMode<TStateAdapter>` joins `GetStateAdapterTxContext` in `state-adapter.ts`.

## Types at call sites

One mapping type, evaluated once per signature:

```ts
type TransactionHooksParam<TMode> = TMode extends "implicit"
  ? { transactionHooks?: never }
  : { transactionHooks: TransactionHooks };
```

It replaces the hard-coded `{ transactionHooks: TransactionHooks }` wherever it is intersected with `GetStateAdapterTxContext`:

- The client's mutating methods: `createChain`, `createChains`, `completeChain`, `deleteChain(s)`, `rescheduleJob(s)`.
- `complete`'s options (`attempt-handler.types.ts:141`, `:183`) and the workerless `completeJob` callback.
- `NewChain & { transactionHooks } & tx context` in the Type Naming Scheme becomes `NewChain & TransactionHooksParam<…> & tx context`.

Read methods don't change; they never took hooks.

Add a case to the type complexity benchmark, since every mutating signature gains one conditional.

## Core resolution

`requireTransactionHooks` (`transaction-hooks.ts:198`) is replaced by `resolveTransactionHooks(stateAdapter, transactionHooks, txCtx, caller)`. It is called after `requireTxCtx`, at the same sites: `client.ts:745, 764, 802, 899, 983` and `attempt-handler.ts:78`.

- **Explicit adapter:** `transactionHooks` is required, as today.
- **Implicit adapter:** a passed `transactionHooks` throws, since passed and bound hooks could disagree. Otherwise `getTransactionHooks(txCtx)`; `undefined` throws `` `${caller}` requires a transaction with bound transactionHooks; open it through the provider's transaction wrapper ``.

Writes that core makes without a caller context keep creating and flushing their own hooks and never look anything up: `rescheduleFailedAttempt` (`attempt-handler.ts:222`), `startJobAttempts`, worker reclaim and stop.

The rules from the Problem section hold by construction in implicit mode. Hooks are created by whoever opens the transaction, a retried transaction is a new transaction with new hooks, and a savepoint gets its own hooks savepoint. `complete`'s at-most-once-per-`transactionHooks` check becomes at-most-once per transaction, with unchanged code.

## Completion counting

Today the worker decides the attempt's outcome when the handler returns. `close()` (`attempt-handler.ts:291`) reads `committed`, which the `complete` slot's `flush` sets (`:93`). With `withTransactionHooks` the flush has already run by then. A provider that settles from a driver signal may flush a tick after the caller's transaction promise resolves, so the handler can return before it. The worker would then fail an attempt that committed.

Change: the `complete` slot tracks a written-but-unsettled write. With an implicit adapter, when the handler returns with such a write, `runAttempt` waits for that slot's hooks to flush or discard before reading `committed`. Explicit mode never waits: there the hooks belong to the caller, and a caller who creates hooks and never flushes them fails the attempt, as before, instead of hanging it. While it waits, the attempt still holds its slot and the worker's lease still covers it.

## Dashboard

`handleJobReschedule` (`dashboard/src/api/routes/jobs.ts:127`) and chain deletion (`dashboard/src/api/routes/chains.ts:132`) open a transaction through `stateAdapter.withTransaction` and pass hooks explicitly. They would throw against an implicit adapter.

Add `withStateAdapterTransaction(stateAdapter, fn)` to `queuert/internal`. With an explicit adapter it wraps `withTransactionHooks` and passes the hooks into the context. With an implicit adapter it calls `withTransaction` alone, relying on rule 5. It opens a transaction through the caller's provider exactly as the dashboard does today, and it is not public API.

## Driver support

The driver-signal implementation needs a signal that fires only on commit. Checked:

| Driver                                       | Commit signal                                                                                                                                                                                                                       | Use                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Knex 3.3                                     | None usable. `trx.executionPromise` also **resolves** on a bare `trx.rollback()`, because `doNotRejectOnRollback` defaults to `true` (`knex/lib/execution/transaction.js:21`, `:180`). `trx.parentTransaction` does expose nesting. | Wrapper, and the wrapper must track rollback itself |
| Kysely, Drizzle, Prisma                      | None                                                                                                                                                                                                                                | Wrapper                                             |
| pg, postgres.js, Bun SQL                     | None                                                                                                                                                                                                                                | Wrapper                                             |
| better-sqlite3, node:sqlite, bun:sqlite      | None exposed                                                                                                                                                                                                                        | Wrapper, which also takes the provider's write lock |
| Sequelize, TypeORM, MikroORM, AdonisJS Lucid | Documented after-commit hooks (`t.afterCommit`, `afterTransactionCommit`, `trx.after('commit')`)                                                                                                                                    | Unverified; check before any example ships          |

No driver in the repo today has a verified commit signal, so the first implementation and its examples use the wrapper.

## Examples

- `state-postgres-kysely-implicit-hooks`: a Kysely provider in implicit mode with app transaction and savepoint helpers and a `WeakMap`. It covers a handler, `createChain`, and a savepoint that rolls back while its transaction commits. The name follows the `state-xxx` convention; the existing `state-postgres-kysely` stays explicit.
- After a driver from the last table row is verified: one driver-signal example.

## Conformance

`runStateAdapterConformance` runs these cases only when the adapter has `getTransactionHooks`:

- Hooks flush only after commit and are discarded on rollback.
- A rolled-back savepoint discards only its own hooks; a released savepoint flushes nothing until the outer commit.
- Two concurrent transactions get different hooks.
- Every transaction from `withTransaction` is bound.
- A passed `transactionHooks` is rejected.
- With a new optional `withUnboundTransaction` fixture, an unbound context is rejected. Wrapper providers supply it; driver-signal providers have no unbound transactions and omit it.

Core specs cover `resolveTransactionHooks` in both modes and completion counting with a flush delayed past handler return.

## Docs

- Transaction hooks guide: an implicit mode section with the wrapper pattern.
- Custom adapters reference: the provider contract above.
- Adapters reference (`advanced/adapters.mdx`): the mode type parameter.
- Job processing reference: completion counting waits for an unsettled `complete`.

## Release

Additive; a `minor` changeset for `queuert`, `@queuert/postgres`, `@queuert/sqlite` and `@queuert/dashboard`.

## Prototype status

Built: the modes and types, `resolveTransactionHooks`, completion counting, PostgreSQL and SQLite forwarding, the dashboard helper, the `state-postgres-kysely-implicit-hooks` example, a changeset, and specs for both modes (`transaction-hooks-mode.spec.ts`). The delayed-commit spec fails when the completion wait is removed.

Not built yet:

- The conformance cases for implicit adapters and the `withUnboundTransaction` fixture.
- The docs pages listed under Docs.
- The type complexity benchmark case.

## Related issue

Explicit mode has the Knex rollback problem today. `withTransactionHooks(… knex.transaction(async (trx) => { …; await trx.rollback(); }))` resolves, so the hooks flush after a rollback. A rolled-back `complete` then counts as completed and its notifications and events go out. This needs its own fix, either in the Knex example provider or as a documented caveat, independent of this design.

## Open questions

1. **Names.** `explicit` / `implicit`, `bind` / `bound` / `unbound`, `getTransactionHooks`, `TransactionHooksParam`. Lean: as written.
2. **Bound on the completion-counting wait.** A provider that breaks rule 2 would hang the attempt. Lean: no timeout; treat it as a contract violation, surfaced by conformance.
3. **Explicit hooks on an implicit adapter as an escape hatch**, for example to share hooks across two transactions. Lean: no; it brings back the disagreement this design removes.
