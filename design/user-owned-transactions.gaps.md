# Design gaps: [EPIC] User-owned transactions

**Design doc:** design/user-owned-transactions.md
**Stopped at:** review (round 1)

The implementation is complete against the design as amended, and `bun run check` passes. Review round 1 found one problem the design does not answer, so the review loop stopped there.

## What the design does not answer

### 1. How does the heartbeat coexist with a handler transaction at REPEATABLE READ / SERIALIZABLE?

- **Resolved:** out of scope. Only READ COMMITTED is supported for now; the stricter levels, their Postgres specs and the blocker-head write (`getChains({ lock: "write" })`) were removed. See "Isolation levels" in the design doc for what supporting them later needs.

### 2. Where is an error thrown after a committed `finish` recorded? (smaller)

- **Where it bites:** `job-process.ts` post-handler path — today it ends the attempt span as `completed` and rethrows the error, which the worker loop records as `workerError`.
- **What the doc says:** "on a throw also record the error, no reschedule" (Commit detection). Silent on which event.
- **Options:** keep `workerError` (worker-level signal, no attempt context); record the exception on the attempt span with status OK plus an attempt-scoped log event (new log type = observability API); or a new `jobAttemptFailedAfterFinish`-style event (new adapter method = breaking for custom observability adapters).
- **Blocked because:** observability API surface. Low severity — can ship with today's behaviour if the doc says so.

## Review findings handled without a design decision

- Fixed: stale TSDoc on `attemptUntil` and the worker `attemptConfig` default; `guides/timeouts.md` and `examples/showcase-timeouts/README.md` described `attemptConfig` as a hard runtime timeout (it is a renewed lease); `benchmarks.md` memory table lost its JIT column; `showcase-error-handling` README mentioned the removed `rescheduleJob` helper; changeset wording about `rescheduleJob` and the `InProcessContext` type change; `AttemptFinish` TSDoc links and the RR/SERIALIZABLE clause; a lint suppression without a reason.
- Not acted on (follow-ups, no design decision needed but out of this round's scope):
  - Validate `attemptConfig` at worker creation (positive integer `timeoutMs`/`heartbeatMs`) — a non-integer `timeoutMs` now breaks pg acquisition for the whole worker.
  - Retry a failed renewal a few times before aborting the attempt — every attempt now depends on the heartbeat.
  - `getBlockers()` without `txCtx` from inside the handler's transaction deadlocks on SQLite / in-process (read lock waits on the caller's write lock); document it on `AttemptGetBlockers`.
  - Link `showcase-long-running-jobs` from a guide (done for `guides/timeouts.md`), mention the SQLite lock requirement on `integrations/state-adapters.mdx` and the `SqliteStateProvider` TSDoc, add fan-in numbers to `benchmarks.md` (benchmarks must be re-run; Process numbers are marked stale).
  - Changeset is long (13 bullets); consider moving the migration recipe to the release notes.

## What was implemented before stopping

Everything in the design's Implementation plan, steps 1–3: `StateAdapter` contract (fences, `timeoutMsByTypeName`, `lock: "write"`, autocommit worker methods, removed `withSavepoint` / `hasBlockers` / `hasBlockedJobs`) in all three adapters; new worker (`finish` in the user's transaction, commit detection, heartbeat, miss classifier, `getBlockers`); middleware reduced to `wrapHandler`; phase sub-spans removed in core and otel; conformance cases (fences, re-acquire, lease, autocommit, blocker race) and Postgres isolation-level specs; new `finish` suite; all suites, examples, benchmarks, docs, design-doc samples and the `major` changeset. State: compiling, `bun run check` green.

## What to decide, in order

1. Where post-commit handler errors are recorded (#2).
