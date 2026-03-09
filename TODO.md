# Short term

- [TASK] Return back isolated declarations
- [TASK] Move benchmarks to a separate folder and dont run the with examples as they are expensive to run
- [REF] Processing capacity benchmark? Like running 100_000 jobs?
- [TASK] Move benchmarks to a dedicated folder and dont run the with examples as they are expensive to run
- [REF] Plugins
  - Attempt middleware plugin
  - Client amend
  - Job definition amend
  - Job processors amend
- [EPIC] Dashboard
  - [TASK,COMPLEX] Better UI
  - [?,REF] Filter by status in chains view
  - [?,REF] Add inputs for date range filtering in chains and jobs views
  - [?,REF] Add job creation, deletion and completion
  - [REF] Migrate dashboard routes from StateAdapter to client API
  - [REF] Fix job detail: fetches all chain jobs to find continuation — use targeted query
  - [REF] Fix stale cursor race condition on filter change in ChainList/JobList
- [TASK,EASY] Fix flaky timeout in `postgres-postgres.data.spec.ts` "handles distributed blocker jobs" (Notify suite) — intermittent `WaitChainTimeoutError`
- [TASK] Use transactionHooks in `deleteJobChains` to buffer post-delete side effects (e.g., observability events)
- [?,TASK] Review `allowEmptyWorker` flag in job-process.ts staged mode — currently set when `prepareTransactionContext.status === "pending"`, may be removable
- [TASK,COMPLEX] Job cleanup utility
- [EPIC] Docs website enhancements
  - [TASK] Add interactive examples / live demos
  - [TASK] Custom branding and styling
- [EPIC] Prepare 0.5 release

# Medium term

- [TASK,COMPLEX] Optimized batched lease renewal
- [EPIC] MCP server
- [EPIC] Sqlite ready:
  - [REF] Better concurrency handling - WAL mode, busy timeout, retries
  - [REF] Separate read/write connection pools (single writer, multiple readers)
  - [REF] usage of db without pool is incorrect
  - [TASK,EASY] Validate `PRAGMA foreign_keys = ON` at adapter init (FK on `job_blocker.blocked_by_chain_id` requires it)
  - [TASK,EASY] get rid of skipConcurrencyTests flag in resilience tests (separate test suite?)
  - [REF] `deleteJobChains` race condition under WAL mode — check-then-delete without row locking; document single-writer assumption or use `BEGIN IMMEDIATE` transactions
- [EPIC] MySQL/MariaDB adapter
- [?,TASK] test against bun and its built-in sqlite, postgres clients
- [?,TASK,MEDIUM] update lease in one operation (currently two: getForUpdate + update)
- [?,REF] Skip unnecessary state adapter calls per processing mode (atomic: no renewJobLease; staged: no getJobForUpdate before complete). Processor-level change, no adapter interface changes needed. See: `process-modes.test-suite.ts` TODOs

# Long term

- [TASK,EASY] Add OpenTelemetry logs support to @queuert/otel adapter (OTEL logs API is experimental)
- [EPIC] Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- [EPIC] Singletons/concurrency limit
- [EPIC] Partitioning (PG) - Scaling concern; defer until users hit limits
- [?,TASK,EASY] Remove `FOR UPDATE SKIP LOCKED` from `getNextJobAvailableInMsSql` — read-only query that only needs the next scheduled time, locking is unnecessary and may return inaccurate sleep durations
- [?,TASK,EASY] Prepared statements — add optional `name` to `PgStateProvider.executeSql`, assign stable names to ~20 fixed queries in pg `sql.ts`; dynamic list queries stay unprepared. Opt-in due to pooler compat (Supavisor, PgBouncer <1.21 break). Benefit: ~0.5–2ms/query on hot path (acquireJob, createJob) at scale
- [?,EPIC] Browser runtime support - SQLite WASM (OPFS) state adapter, Web Workers as job processors, BroadcastChannel notify adapter
