# `wrapHandler` Error Visibility

## Problem

`wrapHandler` is the only attempt middleware hook that cannot observe a failing attempt. A `catch` around `next()` is dead code — it never runs, no matter how the attempt fails. Only `finally` executes.

The cause is where the middleware chain sits relative to the error handling. In `packages/core/src/worker/job-process.ts`, `runJobProcess` ends with:

```ts
await runHandlerMiddlewareChain(
  attemptMiddleware,
  { job: runningJob, workerId },
  async (handlerCtx) => {
    await runJobAttempt(handlerCtx);
  },
);
```

`runJobAttempt` wraps the whole attempt in `try`/`catch`. Its catch calls `handleJobHandlerError` (which records `jobAttemptFailed` and reschedules with backoff), ends the attempt span with `status: "failed"`, and **returns normally**. Because `runJobAttempt` is the innermost callback of the chain, `next()` always resolves — the chain never sees a rejection.

So the middleware onion currently wraps the _executor_ (handler plus reschedule bookkeeping) rather than the _user handler_.

## Asymmetry with the other hooks

The other three hooks do see errors, because they wrap the user callback directly rather than the executor — `runPrepareMiddlewareChain`, `runExecuteMiddlewareChain`, and `runCompleteMiddlewareChain` are each invoked around the user-supplied callback inside `prepare` / `execute` / `complete`. A throwing callback propagates out through those middleware before reaching `runJobAttempt`'s catch.

Three properties of that path are worth stating, because they are not documented and any change here has to stay consistent with them:

- They are **per-callback, not per-attempt**. A handler that throws before calling `complete` never fires `wrapComplete`.
- They only see **user-callback** errors. Hard aborts and lock loss (`throwIfHardAborted`, `refetchJobLocked`) are raised inside `runInGuardedTransaction` _before_ the chain runs; `finishJob` failures happen _after_ it returns. Neither is visible to the middleware.
- Swallowing **changes the outcome**. A `wrapComplete` that catches and returns a value makes that value the job's output, which `finishJob` then commits. The same applies to `wrapPrepare`. Their after-blocks also run before `completeSavepointContext.resolve()`, so success observed there is not yet committed.

## Why this matters

Middleware is the documented place for cross-cutting concerns — contextual logging, audit trails, tracing spans, error classification. Every one of those wants the failure. Today the only way to observe an attempt failure is the observability adapter (`jobAttemptFailed`, and the span ending `failed`), which is a separate, worker-wide surface with no access to the middleware's injected ctx. A middleware that builds a request-scoped logger in `wrapHandler` cannot log the error that ended the attempt with that logger.

## Current state

- `docs/src/content/docs/guides/middleware.md` states the rule for `wrapHandler` ("a `catch` block here never runs") and says nothing about the other three hooks seeing errors, nor about swallowing changing the outcome.
- `examples/showcase-middleware/src/index.ts` carries the same note as a comment and uses `try`/`finally` accordingly.
- `docs/src/content/docs/advanced/in-process-worker.md` does not mention error visibility at all.
- `packages/core/src/suites/worker.test-suite.ts` pins the current behavior in "surfaces callback failures to wrapPrepare/wrapExecute/wrapComplete but not to wrapHandler".

## Constraints on any solution

Whatever shape a fix takes, these have to be answered:

- **Where the attempt is settled.** The reschedule must still commit exactly once, and the transaction contexts (`prepareTransactionContext`, `completeTransactionContext`, `completeSavepointContext`) must each be resolved or rejected on every path. A design that lets a middleware short-circuit the unwinding strands the job with `attempt_until` set until the reclaimer picks it up.
- **Whether a middleware can alter the outcome.** `wrapHandler` returns `Promise<T>` with `T` opaque to the middleware, so it cannot fabricate a success value — a swallowing `wrapHandler` is untypeable today. That property is worth preserving or breaking deliberately, not by accident.
- **Which error is recorded** when a middleware rethrows a different error than the one it caught (the `catch (e) { throw new Enriched(e) }` shape) — the original or the replacement.
- **Ordering against the commit.** Today `wrapHandler`'s `finally` runs _after_ the reschedule commits. Any restructuring that moves the chain inward changes that ordering, for the success path as well as the failure path.
- **Failures that are not handler failures.** Hard aborts (`taken_by_another_worker`, `not_found`, `already_completed`) return early from `handleJobHandlerError` without rescheduling; a failure inside the error handling itself (the inner `catch` in `runJobAttempt`) leaves the attempt unsettled. Whether either class should reach middleware is a separate decision from ordinary handler failures.
- **Middleware bugs must stay distinguishable.** An error thrown by a middleware's own code — before `next()`, or after a successful attempt has already committed — is a worker-level fault today (`workerError`) and should not be silently reclassified as a job failure.

## Compatibility

Any change that makes `catch` live is a **breaking behavior change**, even though no signature moves. Existing `catch` blocks in user middleware are unreachable today; making them run turns previously-dead logging and metrics code live, which double-reports against the observability adapter's `jobAttemptFailed`. It needs a `major` changeset and updates to the middleware guide, the showcase example, the worker reference, and the test above.

## Options sketched, not chosen

- Leave the behavior as-is and document the asymmetry properly (guide, reference, example).
- Add a dedicated `onAttemptError` hook, leaving `next()` always-resolving.
- Move the middleware chain inward so it wraps the user handler instead of the executor, letting the failure propagate through the onion naturally.

No option is selected here — see the constraints above before picking one.
