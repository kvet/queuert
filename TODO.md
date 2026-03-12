# Short term

- [REF] Introduce `poisonExecute(cb)` in PG state provider (callback-scoped variant of `poisonTransaction` for concurrent scenarios) and rework state-resilience tests to use real DB-level errors instead of synthetic JS errors thrown before `executeSql` (poisoning is PG-specific, but all adapters should throw proper DB errors)
- [REF] Reset jobs in chains + dashboard
- [REF] Delete jobs from dashboard
- [REF] Optimize search of chains by status; it requires full scan currently
- [REF] Plugins
  - Attempt middleware plugin
  - Client amend
  - Job definition amend
  - Job processors amend
- [TASK,COMPLEX] Job cleanup utility
- [REF] Vacuum (full vacuum)
- [EPIC] Dashboard
  - [TASK,COMPLEX] Better UI
  - [?,REF] Filter by status in chains view
  - [?,REF] Add inputs for date range filtering in chains and jobs views
  - [?,REF] Add job creation, deletion and completion
  - [REF] Migrate dashboard routes from StateAdapter to client API
  - [REF] Fix job detail: fetches all chain jobs to find continuation — use targeted query
  - [REF] Fix stale cursor race condition on filter change in ChainList/JobList
- [TASK,EASY] Fix flaky timeout in `postgres-postgres.data.spec.ts` "handles distributed blocker jobs" (Notify suite) — intermittent `WaitChainTimeoutError`
- [REF,EASY] Review all public types exported from `@queuert/core` — hide internal-only types (prefix with `_`, remove from `index.ts`). Breaking changes OK
- [TASK] Use transactionHooks in `deleteJobChains` to buffer post-delete side effects (e.g., observability events)
- [?,TASK] Review `allowEmptyWorker` flag in job-process.ts staged mode — currently set when `prepareTransactionContext.status === "pending"`, may be removable
- [EPIC] Docs website enhancements
  - [TASK] Add interactive examples / live demos
  - [TASK] Custom branding and styling

# Medium term

- [EPIC,COMPLEX] Processing throughput (~10x) — currently 4 DB round-trips per job (acquire, getBlockers, renewLease, complete)
  - [REF] Batch job acquisition — acquire N jobs per query instead of 1, amortize loop + transaction overhead
  - [REF] Skip `getJobBlockers` when job type declares no blockers — saves 1 round-trip per job
  - [REF] Merge acquire + initial lease into single operation — `acquireJob` already sets `status=running` but `renewJobLease` sets `leased_by`/`leased_until` separately
  - [REF] Batch completions in one transaction — amortize commit overhead for fast handlers
- [TASK,COMPLEX] Optimized batched lease renewal
- [EPIC] MCP server
- [EPIC] Sqlite ready:
  - [REF] Batch `createJobs` deduplication/continuation checks — currently loops per-job with `findExistingContinuationSql`/`findDeduplicatedJobSql`, O(N) round-trips
  - [REF] Batch `addJobsBlockers` — currently 3-4 sequential queries per jobBlocker entry, O(N) round-trips
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
