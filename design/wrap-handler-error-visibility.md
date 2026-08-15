# `wrapHandler` error visibility

## Problem

`wrapHandler` wraps `runJobAttempt` — the executor that catches handler errors, records the failure, reschedules, and returns normally. Because the middleware sits outside that catch, `next()` always resolves. A `catch` around `next()` is dead code; only `finally` runs.

The other three hooks (`wrapPrepare`, `wrapStep`, `wrapComplete`) don't have this problem — they wrap the user callback directly, inside `runJobAttempt`'s try block, so errors propagate through them naturally.

## Fix

Move `runHandlerMiddlewareChain` inside `runJobAttempt` so it wraps the `attemptHandler` call, not the executor. The middleware sits between the user handler and the catch block — same pattern as the other three hooks.

```
runJobAttempt
  try:
    runHandlerMiddlewareChain        ← moved here
      attemptHandler (user code)
        prepare  → wrapPrepare chain → user callback
        step     → wrapStep chain    → user callback
        complete → wrapComplete chain → user callback
  catch:
    handleJobHandlerError (records failure, reschedules)
```

Errors propagate outward through the handler middleware before reaching the catch. Middleware can observe, log, enrich, or rethrow — but cannot prevent the catch from running, because the catch sits outside the chain.

## Decisions

**Middleware can alter the outcome.** Nothing prevents a middleware from catching and returning — but since `attemptHandler` returns void and the catch block checks whether `complete` was called, swallowing an error without calling `complete` still fails the attempt. This falls out naturally from the types; no special handling needed.

**Enriched errors reach the recorder.** If a middleware catches and rethrows a wrapped error, `handleJobHandlerError` sees the wrapper. Same behavior `wrapPrepare`/`wrapStep`/`wrapComplete` already have.

**Hard aborts propagate through middleware.** `JobTakenByAnotherWorkerError`, `JobNotFoundError`, `JobAlreadyCompletedError` — all of them flow through the middleware chain. No special-casing.

**Ordering change.** `wrapHandler`'s `finally` currently runs after the reschedule commits. Moving the chain inward means `finally` runs before the catch — before the reschedule. This is consistent with how the other hooks work.

**Middleware bugs.** A throw in middleware's own code (before `next()` or after a successful attempt) is caught by `runJobAttempt`'s catch and treated as an attempt failure. Today these would be worker-level errors. The new behavior is more useful — the attempt gets rescheduled instead of crashing the worker.

## Breaking change

Existing `catch` blocks in user `wrapHandler` middleware are dead code today. This change makes them live. In practice, catching errors inside `wrapHandler` was always nonsensical — the promise never rejected — so real-world middleware uses `try`/`finally`. Still a behavioral change: `major` changeset.

## What to update

- `packages/core/src/worker/job-process.ts` — move the chain inside `runJobAttempt`
- `packages/core/src/suites/worker.test-suite.ts` — update the test that pins "handler-resolved" to expect "handler-caught" when the attempt fails
- `docs/src/content/docs/guides/middleware.md` — remove the "catch never runs" caveat
- `examples/showcase-middleware/src/index.ts` — update the comment and optionally add a `catch` example
- `docs/src/content/docs/advanced/in-process-worker.md` — add error visibility note if middleware is mentioned
