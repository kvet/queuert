# Short term

- [TASK,MEDIUM] Rework observability to emit only after transaction commits
  - Problem: spans/logs/metrics emitted inside transactions become misleading if transaction rolls back
  - Affected areas:
    - `startJobChain` / `createStateJob` - span ended and logs emitted before caller's transaction commits
    - `complete()` in job-process.ts - `jobAttemptCompleted` called inside transaction
    - `finishJob` - `completeBlockerSpan` called inside transaction (blocker CONSUMER span emitted before commit)
  - Potential approaches:
    - Buffer pattern (like `withNotifyContext` already does for notifications)
    - Transaction afterCommit hooks (requires state adapter support)
    - Span event pattern: end span for timing, add `transaction.committed` event after commit
  - See: transactional outbox pattern for reliable side effects
- [EPIC] Dashboard
  - [TASK,COMPLEX] Better UI
  - [?,REF] Filter by status in chains view
  - [TASK,MEDIUM] Add list methods to queuert client for programmatic access to dashboard data (chains, jobs, blockers)
- [TASK,MEDIUM] Job cleanup utility
- [?,REF] createInProcessWorker should accept client instance
- [REF] Review state adapter method naming for clarity and consistency
- [REF] Review OTEL tracing design - reconsider trace contexts stored in DB
- [?,REF] Consider extracting a dedicated chain table at the DB level
- [REF] Review state adapter schema design (indices, normalization, etc) to prevent future performance bottlenecks (pending query performance testing and schema analysis) and to better support future features (e.g. singletons, partitioning, etc) and to ensure absence breaking changes in future iterations (e.g. adding new columns to job table should not require altering existing queries)
- [EPIC] Prepare 0.3 release

# Medium term

- [TASK,COMPLEX] Optimized batched lease renewal
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
- [?,EPIC] Browser runtime support - SQLite WASM (OPFS) state adapter, Web Workers as job processors, BroadcastChannel notify adapter
