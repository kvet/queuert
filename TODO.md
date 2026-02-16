# Short term

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
- [TASK,MEDIUM] OTEL blocker spans
- [TASK,EASY] `deleteJobChains` should return deleted chains

# Medium term

- [TASK,COMPLEX] Optimized batched lease renewal
- [EPIC] Dashboard
- [EPIC] MCP server
- [EPIC] Sqlite ready:
  - [REF] Better concurrency handling - WAL mode, busy timeout, retries
  - [REF] Separate read/write connection pools (single writer, multiple readers)
  - [REF] usage of db without pool is incorrect
  - [TASK,EASY] Validate `PRAGMA foreign_keys = ON` at adapter init (FK on `job_blocker.blocked_by_chain_id` requires it)
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
- [EPIC] Website for docs, examples, dashboard, etc (currently in monorepo README)

# Long term

- [TASK,EASY] Add OpenTelemetry logs support to @queuert/otel adapter (OTEL logs API is experimental)
- [EPIC] Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- [EPIC] Singletons/concurrency limit
- [EPIC] Partitioning (PG) - Scaling concern; defer until users hit limits
