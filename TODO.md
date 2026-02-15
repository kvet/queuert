# Short term

- [BUG,FLAKY] Fix flaky tests
  - State Resilience > handles transient database errors gracefully with multiple slots/workers (1-4/10 across postgres specs)
  - Worker > processes jobs in order with multiple slots (2/10 in postgres-postgres and postgres-in-process) - race condition with concurrent slot processing
  - Notify > notifies workers when reaper deletes "zombie" jobs (1/10 in sqlite-in-process)
  - Process > throws error when prepare, complete, or continueWith called incorrectly (1/10 in postgres-noop)
- [TASK,SMALL] Notify resilience tests in core
- [TASK,MEDIUM] Rework otel testing to not rely on the mock implementation that doesn't make any sense to test against
- [TASK,COMPLEX] Get rid of `startBlockers` method - just provide blockers when creating jobs
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
- [TASK,EASY] Run postgres against multiple versions
- [TASK,EASY] Run redis against multiple versions

# Medium term

- [TASK,MEDIUM] OTEL blocker spans
- [TASK,COMPLEX] Optimized batched lease renewal
- [EPIC] Dashboard
- [EPIC] Sqlite ready:
  - [REF] Better concurrency handling - WAL mode, busy timeout, retries
  - [REF] Separate read/write connection pools (single writer, multiple readers)
  - [TASK,EASY] get rid of skipConcurrencyTests flag in resilience tests
  - [REF] usage of db without pool is incorrect
  - [TASK,EASY] Run against multiple versions
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
