# Short term

- [EPIC] Dashboard
  - [TASK,COMPLEX] Better UI
  - [?,REF] Filter by status in chains view
  - [?,REF] Add inputs for date range filtering in chains and jobs views
- [TASK,MEDIUM] Add list methods to queuert client for programmatic access to dashboard data (chains, jobs, blockers). See [Client](docs/design/client.md)
- [TASK,COMPLEX] Job cleanup utility (see [Plugins](docs/design/plugins.md), [Cleanup Plugin](docs/design/cleanup-plugin.md))
- [TASK,COMPLEX] Rework CommitHooks → TransactionHooks with transactional observability
  - See [Transaction Hooks](docs/design/transaction-hooks.md) for the new design (discard callback, awaitable discard)
  - **Step 1**: Implement TransactionHooks (rename CommitHooks, add `discard` to hook definition, make `discard()` awaitable)
    - `commit-hooks.ts` → `transaction-hooks.ts`
    - Hook definition: `{ state, flush }` → `{ state, flush, discard }`
    - `discard()` calls each hook's `discard(state)` instead of just clearing
    - Update all consumers: client, worker, notify-hooks, observability
  - **Step 2**: Buffer observability events via transaction hooks (emit only after commit, run discard on rollback)
    - Problem: spans/logs/metrics emitted inside transactions become misleading if transaction rolls back
    - `createStateJob`: wrap span ends, `jobChainCreated`, `jobCreated`, `jobBlocked` in hook buffering
    - `finishJob`: wrap `jobCompleted`, `jobDuration`, `completeJobSpan`, `jobChainCompleted`, `jobChainDuration`, `completeBlockerSpan`, `jobUnblocked`
    - `handle-job-handler-error.ts`: add `transactionHooks` param, wrap `jobAttemptFailed`
    - `job-process.ts`: wrap `jobAttemptCompleted`, add snapshot/rollback around complete and error-handling transactions
    - NOT buffered: span starts (need trace context for DB writes), events outside transactions (`jobAttemptStarted`, `jobAttemptDuration`, `jobAttemptLeaseRenewed`, attempt span end)
    - NOT buffered: `refetchJobForUpdate` events (read-only observations, not write claims)
    - Self-cleaning: `createStateJob` and `finishJob` should snapshot on entry and rollback on throw
  - **Step 3**: Update design docs
    - `observability-adapter.md`: add "Transactional Guarantees" section
    - `job-processing.md`: note that observability in prepare/complete phases is transactional
    - `client.md`: update CommitHooks references to TransactionHooks
  - **Tests** (12 rollback tests):
    - `logging.spec.ts` (6 tests asserting via `log` mock):
      1. Creation rollback — `startJobChain` in transaction that throws → no `job_chain_created`, `job_created`
      2. Creation with blockers rollback — no `job_blocked` or creation events
      3. Workerless completion rollback — `completeJobChain` throws → creation events present, no `job_completed`/`job_chain_completed`
      4. Worker complete rollback — inject `completeJob` failure → no `job_attempt_completed`/`job_completed`, but `job_attempt_failed` IS emitted
      5. Worker error-handling rollback — inject `rescheduleJob` failure → no `job_attempt_failed`
      6. Continuation rollback — inject `createJob` failure during continuation → no continuation `job_created`, no `job_attempt_completed`
    - `otel.spec.ts` (6 matching tests asserting via `expectMetrics`/`expectSpans`):
      1-6. Same scenarios asserting no metrics/spans for rolled-back operations
    - Tests 4-6 use the `erroringStateAdapter` override pattern (see `otel.spec.ts:679-688`)
    - Note: buffering changes span ordering — PRODUCER spans from `createStateJob` move after attempt CONSUMER spans (deferred to flush)
- [REF] Review state adapter method naming for clarity and consistency
- [REF] Review OTEL tracing design - reconsider trace contexts stored in DB
- [?,REF] Consider extracting a dedicated chain table at the DB level
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
