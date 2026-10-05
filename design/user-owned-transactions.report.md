# Implemented: [EPIC] User-owned transactions

**Design:** design/user-owned-transactions.md · **Status:** bailed at review round 1 (one design gap — see design/user-owned-transactions.gaps.md)

## What changed

- **Adapters (in-process, Postgres, SQLite):**
  - Writes tied to an attempt are now "fenced": they only go through if this exact attempt still owns the job, and they write all or nothing.
  - The lease is set when a job is acquired.
  - New `getChains({ lock: "write" })`.
  - The worker's own writes no longer need a transaction.
  - `withSavepoint`, `hasBlockers` and `hasBlockedJobs` are gone.
- **Worker:** queuert opens no transaction during processing. The handler calls `finish` in its own transaction and returns what `finish` returned. Blockers are read on demand with `getBlockers()`. After the handler ends, the worker asks the database whether `finish` committed.
- **Removed:** `prepare`/`step`/`complete`, the processing modes, the extra middleware phases (only `wrapHandler` is left), and the phase sub-spans in OTel.
- **Tests:**
  - New `finish` suite.
  - New adapter tests: fences, same-worker re-acquire, lease, the blocker race.
  - New Postgres tests at the stricter isolation levels.
  - All old suites rewritten.
- **Examples:** all rewritten. `showcase-processing-modes` is now `showcase-long-running-jobs`.
- **Also updated:** the docs, the benchmarks, and one `major` changeset.

## Design decisions applied

Decisions answered during the session:

- Reclaim stores a named error (`JobAttemptExpiredError: …`).
- There's no blocker preloading; handlers use `getBlockers()`.
- The blocker-head write is `getChains` `lock: "write"`, a no-op UPDATE with no version column.
- A handler that returns without `finish` counts as a handler error.
- The heartbeat isn't paused by `finish`, and a renewal miss after the attempt's own committed `finish` is a no-op.
- The handler must return the `finish` result.
- `extendJobAttempt` takes a required `fence`.

## Deviations from the design

- The handler return type is "a finished job" (`Exclude<AnyJob, running>`), not `AttemptFinishResult`.
- `InProcessContext` now has required fields, so `finish` can't be called without a real transaction context.

## Review outcomes

- **Fixed:**
  - A bug in the Postgres and SQLite code: one batch that continued the same job twice slipped through.
  - The "expired" warning could fire twice.
  - SQLite stored the reclaim error in a different format.
  - A too-strict type constraint.
  - Several stale docs and comments.
- **Stopped on:** the heartbeat vs REPEATABLE READ / SERIALIZABLE problem. It's in design/user-owned-transactions.gaps.md, along with smaller follow-ups.

## Verification

- **First full `bun run check`:** exit 0. 116 test files, 6197 tests passed, 259 skipped, and all typecheck and example runs exited with code 0.
- **Re-run after the review fixes (docs and comments only):** exit 1. The only failure was one Postgres test, "handles real database errors gracefully", which hit its 15s timeout. It passed 3 out of 3 times when run on its own, so it's probably flaky under full-suite load. Watch it.
- **Not done:** no commit, and `TODO.md` still lists the epic, because the work stopped on the gap.

## Next step

Pick an option for the heartbeat problem in the gap report. Recommended: "document it: call `finish` first at the stricter levels". Then run `/implement-task` again.
