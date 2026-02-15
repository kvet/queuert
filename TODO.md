# Short term

- [BUG,FLAKY] Fix flaky tests
  - Notify > notifies workers when reaper deletes "zombie" jobs (1/10 in sqlite-in-process)
  - Process > throws error when prepare, complete, or continueWith called incorrectly (1/10 in postgres-noop)
- [TASK,MEDIUM] Rework observability to emit only after transaction commits
  - Problem: spans/logs/metrics emitted inside transactions become misleading if transaction rolls back
  - Affected areas:
    - `startJobChain` / `createStateJob` - span ended and logs emitted before caller's transaction commits
    - `complete()` in job-process.ts - `jobAttemptCompleted` called inside transaction
  - Potential approaches:
    - Buffer pattern (like `withNotifyContext` already does for notifications)
    - Transaction afterCommit hooks (requires state adapter support)
    - Span event pattern: end span for timing, add `transaction.committed` event after commit
  - See: transactional outbox pattern for reliable side effects
- [EPIC] extract state and notify adapter test suites to efficiently test multiple configurations (prefixes etc)
  - [TASK,MEDIUM] support all methods for state adapter test suite
  - [TASK,MEDIUM] notify adapter
- [REF,MEDIUM] Evaluate removing `rootChainId` and `originId` from job model
  - `rootChainId`: Only used for cascade deletion (`deleteJobsByRootChainIds`). Deletion is the caller's problem; chain structure already captured via `chainId`
  - `originId`: Only informational (observability logs, OTEL spans). The in-process adapter uses it for continuation deduplication but pg/sqlite don't — no unique constraint or ON CONFLICT
  - Post-hoc update in `addJobBlockers` sets these on blocker chains — should be removed regardless (blocker chains are independent dependencies, not continuations)
  - Affects: state adapter interface + all implementations, helper.ts, client.ts, job-process.ts, observability, tests
- [TASK,MEDIUM] OTEL blocker spans

# Medium term

- [TASK,COMPLEX] Optimized batched lease renewal
- [EPIC] Dashboard
- [EPIC] Sqlite ready:
  - [REF] Better concurrency handling - WAL mode, busy timeout, retries
  - [REF] Separate read/write connection pools (single writer, multiple readers)
  - [REF] usage of db without pool is incorrect
  - [TASK,EASY] get rid of skipConcurrencyTests flag in resilience tests (separate test suite?)
- [EPIC] MySQL/MariaDB adapter
- [REF] Revisit Prisma examples
- [?,TASK] test against bun and it's built-in sqlite, postgres clients
- [?,TASK,MEDIUM] update lease in one operation (currently two: getForUpdate + update)
- [?,TASK,COMPLEX] Consolidate state adapter operations into atomic combined methods
  - `acquireJob` should include `getJobBlockers` (avoid separate call after acquire)
  - `completeJob` should include `scheduleBlockedJobs` and return the completed job (avoid separate `getJobById` after complete)
  - Atomic mode should not need `renewJobLease` (prepare+complete in same transaction)
  - Staged mode should not need `getJobForUpdate` before complete (job already held by worker)
  - See: `process-modes.test-suite.ts` TODOs for per-mode call traces

# Long term

- [TASK,EASY] Add OpenTelemetry logs support to @queuert/otel adapter (OTEL logs API is experimental)
- [EPIC] Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- [EPIC] Singletons/concurrency limit
- [EPIC] Partitioning (PG) - Scaling concern; defer until users hit limits
