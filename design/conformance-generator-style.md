# Conformance cases in generator style

Write every conformance case as one generator body, so that over a synchronous adapter each adapter and client call runs synchronously and is checked against the sync contract, and over an asynchronous adapter it is awaited as today.

## Problem

Conformance cases are `async` functions that `await` every adapter and client call. Only transaction bodies are mode-aware: `inTransaction` and `withCaseTransaction` run a `function*` body through `runSteps`, which in sync mode passes every yielded value through `requireSync`. Everywhere else an `await` makes a sync and an async method look the same:

- A sync adapter or client method that returns a promise outside a transaction (`startWorker`, a context-free `getJobs`, `listenJobScheduled`, `client.getJob`) passes, because `await` unwraps it.
- A sync method that rejects instead of throwing passes too. `rejectionOf(async () => { await fence(…) })` in `conformance.end-to-end/cases/process.ts` turns a synchronous throw into a rejection, so the case proves `fence` fails but not that it throws synchronously.
- Notify conformance has one explicit mode check, `assertUnsubscribeResult` in `conformance.notify-adapter/groups.ts`; no other notify method is checked.

The sync contract is today tested only by `client/client.mode.spec.ts` and `@queuert/sqlite`'s `sync-adapter.spec.ts`, not by the suites third-party adapters run.

## Scope

| Suite          | Location                                                                                           | Size                           | Needs                        |
| -------------- | -------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------- |
| State adapter  | `conformance.state-adapter/cases/*.ts` (35 files), `index-coverage-cases.ts`, `seed-all-states.ts` | ~15,000 lines, ~1,760 `await`s | `step` only                  |
| Notify adapter | `conformance.notify-adapter/groups.ts`                                                             | ~630 lines                     | `step` and `wait`            |
| End-to-end     | `conformance.end-to-end/cases/*.ts` (17 files), `support/`                                         | ~17,000 lines, ~1,960 `await`s | `step`, `wait` and resources |

Twelve state-adapter and fourteen end-to-end case files already use `function*` transaction bodies. `index-coverage-cases.ts` and `seed-all-states.ts` were made mode-agnostic with `inTransaction` for the in-process query benchmark.

## Design

### Primitives

- **`yield* step(x)`** (exists, `@queuert/helpers/steps`): an adapter or client call. Sync mode requires a plain value (`requireSync`); async mode requires a promise and awaits it. A sync throw surfaces at the call inside the generator; an async rejection is thrown back in with `steps.throw`, so `try`/`catch` in the body handles both.
- **`yield* wait(promise)`** (new): genuinely asynchronous orchestration that is async in both modes — worker runner `start` / `stop` / `close`, `awaitChain`, notify delivery (`waitFor`, `raceWithSleep`), `sleep`, `retryUntilPasses`, `Promise.withResolvers` handoffs. Always awaited; its rejection is thrown back into the generator.
- **Resources** (new): generators have no `await using`. `const stateAdapter = yield* resource(createStateAdapter())` registers the value's disposer; the driver disposes registered resources in reverse order when the body returns or throws, awaiting `Symbol.asyncDispose` or calling `Symbol.dispose`. This replaces every `await using` / `using` in case bodies.

### Driver

`caseBody(function* (context) { … })` returns the `run: (context) => Promise<void>` that `ConformanceCase` already declares, so the public case and group types do not change. The driver is async in both modes: it awaits `wait` values, and treats `step` values by mode — `requireSync` in sync mode, a required thenable that it awaits in async mode. `wait` yields a tagged wrapper so the driver can tell the two apart.

### Mode

The driver needs the mode before the first step. Every case starts by creating the adapter under test with `resource`, which is awaited in both modes, so the driver takes the mode from that first resource's `sync` marker (`isSyncAdapter`). A step before the first resource fails the case. The context types do not change.

### Helpers that go away

- `rejectionOf` (`conformance.end-to-end/support/rejection-of.ts`): replaced by `try { yield* step(fn()) } catch (error) { … }` or a small generator helper; this also settles whether it belongs in `@queuert/helpers`.
- `assertUnsubscribeResult`: `step` checks both modes.
- `inTransaction` and `withCaseTransaction` stay, called as `yield* step(inTransaction(stateAdapter, function* (txCtx) { … }))`.

Context members are test harness that pass through what their callback returns, so their result follows the adapter's mode only when the callback returns an adapter or client result. `createStateAdapter` and `createNotifyAdapter` go through `resource`. `withNonTransactionContext` and `withWritesFenced` go through `step` with a callback that returns the adapter's or client's result directly (not an `async` callback), so the adapter calls inside are checked; the one exception is `isTransaction`, which returns a boolean in both modes, through `wait`. A `withSavepoint` call whose callback only registers transaction callbacks is composed with `andThen` in a plain `withTransaction` callback instead of being stepped. Their `MaybePromise` types stay; a sync context's members must be synchronous.

Transaction bodies run by `inTransaction` and `inMode` (`conformance/adapters.ts`) use `runSteps` in sync mode and their own strict runner in async mode, which fails the body on a plain value after its `finally` blocks run, so async adapters are checked inside transactions too. `runSteps` itself stays lenient, since `modal` relies on it.

### Async-only groups

Groups tagged `mode: "async"` (concurrent open transactions in `conformance.state-adapter/groups.ts`) can keep their async bodies; they never run over a sync adapter. Converting them is optional and uses `wait(Promise.all(…))` for the interleaving.

## Phases

Each phase lands as its own commit with every suite green in both modes over the in-process adapters (async and sync), SQLite (async and sync), PostgreSQL, MySQL / MariaDB and Redis.

1. **Primitives and driver** in `@queuert/helpers`: `wait`, `resource`, `caseBody`, with specs, including a sync body that yields a promise through `step` failing and through `wait` passing.
2. **State-adapter cases**, `index-coverage-cases.ts` and `seed-all-states.ts`: mechanical `await X` → `yield* step(X)`, `await using` → `resource`.
3. **Notify cases**: adapter calls to `step`, delivery waits to `wait`; drop `assertUnsubscribeResult`.
4. **End-to-end cases and `support/`**: classify every `await` as `step` or `wait`; delete `rejection-of.ts`.
5. **Docs**: code-style's "Conformance cases and tests may use generators" becomes the rule for conformance cases; the custom adapter docs state that the sync suites check the sync contract.

Each conversion phase adds a negative spec in `conformance/suite.spec.ts`: a sync adapter whose method returns a promise outside a transaction must fail at least one case of that suite.

## Release note

The case and group types are unchanged, but a third-party sync adapter that returns promises outside transactions, or rejects instead of throwing, starts failing the sync suites, and a third-party async adapter whose methods return plain values instead of promises starts failing the async suites. That is a user-visible behavior change for adapter authors and needs a changeset.

## Decisions

1. **Strict async.** Async mode asserts that an async adapter returns promises: `step` over an async adapter requires a thenable, the counterpart of `requireSync`. This replaces both branches of `assertUnsubscribeResult`.
2. **Mode source.** The driver reads the mode from the first resource a case creates, the adapter under test, so contexts carry no mode field and a context cannot disagree with its adapter.
3. **Violations.** A step that breaks its mode is thrown into the body, so its `finally` blocks run, and fails the case even when the body catches it.
