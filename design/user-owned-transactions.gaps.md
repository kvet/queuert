# Design gaps: [EPIC] User-owned transactions

**Design doc:** design/user-owned-transactions.md
**Stopped at:** review (round 1)

The implementation is complete against the design as amended, and `bun run check` passes. Review round 1 found one problem the design does not answer, so the review loop stopped there.

## What the design does not answer

### 1. How does the heartbeat coexist with a handler transaction at REPEATABLE READ / SERIALIZABLE?

- **Where it bites:** `packages/core/src/worker/job-process.ts` (heartbeat `commitRenewal` → `extendJobAttempt`) against `finish`'s fenced `UPDATE` of the same job row (pg `completeJobs` / `continueJobs` / `rescheduleJobs`).
- **What happens:** the heartbeat writes the job row (`attempt_until`) in autocommit every `heartbeatMs`, for every attempt. On Postgres at REPEATABLE READ or SERIALIZABLE, if the handler's transaction took its snapshot (ran any statement) before a renewal committed, the later fenced `UPDATE` in `finish` raises a serialization error (40001). A handler transaction that always lasts longer than `heartbeatMs` before calling `finish` fails on every attempt, so the job is retried forever. READ COMMITTED is unaffected (the fenced `UPDATE` waits and re-checks).
- **What the doc says:** the isolation table (line ~127) says a fenced `UPDATE` at RR/SERIALIZABLE raises a serialization error when "the row changed since the snapshot", and that a serialization error is "an ordinary database error … fenced reschedule with backoff". It never considers that the worker's own heartbeat is that concurrent writer, on a timer. The "Heartbeat" section (amended per the user's answer) says the heartbeat runs until the handler ends and relies on database locks.
- **Options, with consequences:**
  - **(a) Document a constraint:** at RR/SERIALIZABLE, call `finish` as the first statement of the transaction (its row lock makes renewals wait and the snapshot is taken after it), or keep the transaction's pre-`finish` part shorter than `heartbeatMs`. No code change; a sharp edge users must know; add a pg spec showing both the failure and the "finish first" pattern.
  - **(b) Move the lease off the job row:** the heartbeat touches a per-attempt or per-worker lease row instead of `job.attempt_until`. Removes the conflict and the renewal-waits-on-row-lock behaviour; this is where `design/worker-liveness.md` is heading. Persisted-state change (new table or columns, migrations in pg and sqlite) and it pulls part of worker liveness into this release.
  - **(c) Pause renewals while a `finish`-bearing transaction may be open:** not implementable — the worker cannot see when the user's transaction began. Listed only to rule it out.
- **Blocked because:** observable runtime semantics (handlers at stricter isolation levels can fail indefinitely), and option (b) changes the persisted schema.

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

1. Heartbeat vs RR/SERIALIZABLE (#1): document-and-test (a), or move the lease off the job row (b).
2. Where post-commit handler errors are recorded (#2).
