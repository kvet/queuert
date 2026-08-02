# Attempt finalization rework

Split the attempt's final phase from its outcome. `finalize` opens the transaction; `complete` and
`continueWith` are sibling terminal actions inside it, each applying its transition immediately.

## Problem

Three separate issues converge on `AttemptComplete` in `worker/job-process.ts`.

### The terminal outcome is inferred from the return value's shape

Today the handler picks its outcome by what it returns from the complete callback:

```ts
complete(async ({ continueWith }) => continueWith({ ... })); // → continuation
complete(async () => ({ delivered: true })); // → completion
```

`AttemptComplete` discriminates with
`TReturn extends JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "output"> ? Completed : ContinuationJobs`
— a structural test against a user-declared type. It degrades wherever the user controls the shape:

- An `output` declared as `unknown`, `any`, or a union overlapping `ContinuationJobs` resolves the
  conditional to the wrong branch or to a union of both. Nothing in `defineJobTypes` prevents
  declaring such an output.
- Void-output jobs cannot distinguish "completed with no output" from "forgot to return".
- Calling `continueWith` _and_ returning an output is representable and silently tolerated. The
  runtime resolves it by precedence rather than rejecting it — `finishJob` receives both, writes
  `outcome: { continuedToId }`, and the caller gets `continuedJob ?? output` (`client.ts`, the
  workerless path). The type system does not model the conflict at all.

The internals are already a proper sum type: `finishJob` takes
`outcome: continuedJob ? { continuedToId: continuedJob.id } : { output }`. The inference is a
type-level veneer over a representation that is explicit one layer down.

### Neither terminal transition is applied while the callback runs

`continueWith` looks effectful — it writes a row — but it only calls `continueStateJob`. The
current job stays `running`, the chain is not promoted, and `unblockJobs` has not run. The actual
transition happens in `finishJob`, invoked at `job-process.ts:625`, **after** the callback returns
at `job-process.ts:591`.

So any client call the handler makes after deciding its outcome runs against a snapshot where the
job is still in flight. The recurring-chain pattern is the case that hurts: a terminal job
self-scheduling its next occurrence under `scope: "running"` matches the chain that is completing,
and has to pass `excludeChainIds: [job.chainId]` to exclude itself.
[chain-identity.md](chain-identity.md) identifies this ordering as the sole reason
`excludeChainIds` exists, and depends on a transaction context being available after `complete()`
resolves. Applying the transition inline delivers that directly, and supersedes both candidate
shapes sketched there (post-`complete` `execute`, or a second callback on `complete`) — the code
following a terminal action is already inside the finalization transaction and already sees the
completion write.

### `complete` names a phase but reads as an outcome

`complete(async () => continueWith(...))` reads as "complete this job by not completing it." The
outer function's responsibility is opening the finalization transaction; the outcome is chosen
inside. The name claims one of the two outcomes for the phase, which also breaks the symmetry of
the phase trio — `prepare` and `execute` name phases, `complete` names a result.

## Approach

### Shape

```ts
attemptHandler: async ({ job, prepare, finalize }) => {
  const state = await prepare({ mode: "staged" }, async ({ sql }) => /* ... */);

  const result = await doWork(state);

  return finalize(async ({ complete, continueWith, transactionHooks, ...txCtx }) => {
    const terminal = result.done
      ? await complete({ delivered: true })
      : await continueWith({ typeName: "send-receipt", input: { ... } });

    // Runs after the transition is written, in the same transaction.
    await client.createChain({
      ...txCtx,
      transactionHooks,
      typeName: "daily-report",
      deduplication: { key: "daily-report", scope: "running" },
    });

    return terminal;
  });
};
```

### Both actions apply the transition inline

Both route through the function that already models the sum type:

- `complete(output)` → `finishJob({ output })` — job completed, chain promoted, `unblockJobs` run,
  notify and observability events buffered.
- `continueWith(opts)` → `continueStateJob(...)` then `finishJob({ continuedJob })` — job finished
  as continued, chain stays running.

Both are `async`. After either resolves, subsequent code in the callback observes the post-transition
state. A throw after the terminal action rolls the transition back with everything else via the
existing complete savepoint, and the job retries — unchanged from today.

### The conditional type disappears

Terminal actions return branded values, so `finalize` has nothing left to discriminate:

```ts
declare const terminalBrand: unique symbol;

type Terminal<T, K extends "completed" | "continued"> = T & {
  readonly [terminalBrand]: K;
};

type AttemptTerminal<...> =
  | Terminal<ResolvedJobWithBlockers<...> & { status: "completed" }, "completed">
  | Terminal<ContinuationJobs<...>, "continued">;

export type AttemptFinalize<...> = <TTerminal extends AttemptTerminal<...>>(
  finalizeCallback: (
    options: {
      complete: (
        ...args: [output: JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "output">]
      ) => Promise<Terminal<ResolvedJobWithBlockers<...> & { status: "completed" }, "completed">>;
      continueWith: <TContinueJobTypeName extends JobTypeContinuation<...> & string>(
        options: { typeName: TContinueJobTypeName; id?: ...; input: ...; schedule?: ScheduleOptions } & Blockers,
      ) => Promise<Terminal<ContinuationJobs<...>, "continued">>;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter> &
      TFinalizeCtx,
  ) => Promise<TTerminal>,
) => Promise<TTerminal>;
```

`finalize` returns `TTerminal` verbatim. The rework deletes a conditional type from the public
surface rather than relocating it — the remaining discrimination is over library-owned brands, not
user-declared output shapes.

The brand is a phantom symbol property, so `.id` / `.output` access on the handler's return value is
unaffected. It exists only so a hand-constructed object cannot satisfy the callback contract, which
is the ambiguity being removed.

Typing the output as `...args: [output: TOutput]` rather than `output: TOutput` lets void-output
jobs write `complete()` with no argument — the case the current "return `undefined`" path cannot
express unambiguously.

### The rest of the surface

**Middleware** (`worker/attempt-middleware.ts`) — `wrapComplete` → `wrapFinalize`, and the
`TCompleteCtx` generic → `TFinalizeCtx` across `job-process.ts`, `processors.ts`,
`create-processors.ts`. One behavioral change rides along: the built-in keys that win over
middleware-injected ctx grow from `{ continueWith, transactionHooks }` to
`{ complete, continueWith, transactionHooks }`. The ctx-merge guard and
`in-process-worker.attempt-middleware.spec.ts` ("complete built-ins win over middleware-injected
ctx") both need updating.

**`completeChain`** (`client.ts`) — the same split, so worker and workerless completion do not
diverge. Its inner `complete(job, cb)` becomes `finalize(job, cb)` with `complete` / `continueWith`
in the callback, and the `return continuedJob ?? output` precedence fallback is deleted along with
the ad-hoc `throw new Error("continueWith can only be called once")`.

**Auto-setup** — the inference rule is unchanged, only renamed: synchronous `finalize` → atomic
mode, otherwise `prepare({ mode: "staged" })` is auto-called. The
`"Prepare cannot be accessed after auto-setup"` message stays; the mode section of
`docs/src/content/docs/advanced/job-processing.md` and the processing-modes guide need the new name.

Terminal actions stay exclusive to `finalize` — not reachable from `prepare` or `execute`, even
though `execute` opens real transactions.

### Errors

- Second terminal action after the first — a new `JobAlreadyFinalizedError` carrying which
  transition already ran, replacing the two ad-hoc `Error`s. Distinct from
  `JobAlreadyCompletedError`, which describes persisted state rather than a misuse of the callback.
- Callback returns without a terminal — a type error via `TTerminal`, plus a runtime guard for
  `any`-typed escapes. Throw rather than defaulting to completion.
- Output validation (`parseOutput`) moves from inside `finishJob`-after-the-callback to the
  `complete(...)` call site, so the stack points at the offending line. Both still roll back via
  savepoint.

## Open questions

- **Naming.** `finalize` collides semantically with GC finalizers (`FinalizationRegistry`, Java/Go).
  `settle` matches the intent precisely — reaching one of two terminal states — and carries no such
  baggage. `finish` should be avoided: it collides with the internal `finishJob` /
  `finishJobAttempt` while also reading as a synonym for `complete`.
- **Observability event ordering.** All events are buffered into `transactionHooks` and flushed
  post-commit, but the buffer order changes: today `jobAttemptCompleted` is buffered before
  `finishJob` emits `jobCompleted` / `chainCompleted`; inline transitions reverse that. Decide
  whether the attempt-level event moves inside the terminal action to preserve the order, or whether
  the order is not part of the contract.
- **Attempt span boundaries.** `attemptSpanHandle.end(...)` and `jobAttemptDuration` currently fire
  after the callback returns. Should user work performed _after_ the terminal action count toward
  attempt duration and sit inside the attempt span? Keeping the span open until the savepoint closes
  seems right, but it means the span outlives the completion write it reports.
  `startComplete()` → `startFinalize()` renames alongside.
- **`execute` after a terminal action.** Now that post-terminal work is possible inside `finalize`,
  is there still a case for `execute` running after completion? Fresh guarded transactions after the
  job is finished have no attempt to verify against, which argues for disallowing it.
- **`excludeChainIds` removal sequencing.** This rework unblocks it, but both are breaking. Land
  them in one major, or separately with [chain-identity.md](chain-identity.md) following?
- **Batched processors.** [batched-processors.md](batched-processors.md) lists the
  `complete`/`continueWith` shape as an open question for array-shaped handlers. Per-job terminal
  actions inside one batch `finalize` is a plausible answer — worth checking the two designs agree
  before either lands.
- **Migration mechanics.** `complete(async (ctx) => X)` → `finalize(async (ctx) => ctx.complete(X))`
  is mechanical when the callback body ends in a simple return; `continueWith` branches change only
  by nesting. Is a codemod worth shipping, or is the surface small enough for release-note guidance?

## Scope

Breaking (`major`) for `@queuert/core` plus anything re-exporting the handler or middleware types
(`@queuert/otel` middleware, dashboard if it touches them). One changeset covering the whole rename
— handler API, middleware hooks, `completeChain` — not one per site. Touches every example, the
`suites/` shared test suites, `job-processing.md`, and the processing-modes guide.
