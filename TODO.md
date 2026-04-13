# Short term

- [TASK] Change attemptMiddleware to wrapAttemptHandler, wrapPrepare, wrapCompleteHandler, etc. to allow more flexible middleware that can add additional parameters (e.g. context) and is not limited to the acquire+execute+complete flow — see `design/handler-wrapping.md`
- [TASK] Support triggering multiple jobs
- [?,TASK] Simplify `mergeJobTypeProcessorRegistries` and `mergeJobTypeRegistries` to not use slices as a named parameter
- [EPIC] Multi-driver support (postgres.js) — branch `feat/multi-driver-support`. Experimental; needs review before merge (type safety regression in executeTypedSql, missing resilience test coverage for postgres.js, JSON serialization verification)
- [EPIC] multi-driver support for notify adapter
- [EPIC] test against bun and its built-in sqlite, postgres, redis clients
- [TASK] Name internal types properly. No underscore. Add to code-style guide.
- [TASK] Enforce json-serializable inputs and outputs (like no Date in job definitions)

# Medium term

- [?,REF] For update locking in list methods (e.g. `listJobChainsForCleanup`), add option to skip locking when the method is used in a context where concurrent modifications are not a concern (e.g. cleanup job listing its own completed chains for deletion)
  - [?,REF] Change complete job chain to something more empirical?
- [REF] Handle routing with seroval on dashboard instead of path-based routing (e.g. `/chains/${chainId}` → `/chain?chainId=${chainId}`) — simplifies dashboard API and allows more flexible UI patterns (modals, nested views)
- [REVIEW] Review `addJobBlocker` design — see `design/add-job-blocker.md`
- [TASK,COMPLEX] Better dashboard UI
- [REF] Add input and output filtering
- [EPIC] Docs website enhancements
  - [TASK] Add interactive examples / live demos
  - [TASK] Custom branding and styling
- [REF] Reset jobs in chains + dashboard
- [EPIC,COMPLEX] Processing throughput (~10x) — currently 4 DB round-trips per job (acquire, getBlockers, renewLease, complete)
  - [REF] Batch job acquisition — acquire N jobs per query instead of 1, amortize loop + transaction overhead
  - [REF] Skip `getJobBlockers` when job type declares no blockers — saves 1 round-trip per job
  - [REF] Merge acquire + initial lease into single operation — `acquireJob` already sets `status=running` but `renewJobLease` sets `leased_by`/`leased_until` separately
  - [REF] Batch completions in one transaction — amortize commit overhead for fast handlers
- [TASK,COMPLEX] Optimized batched lease renewal
- [EPIC] MCP server
- [EPIC] Sqlite ready:
  - [REF] Cache prepared statements in examples — `executeSql` calls `database.prepare(sql)` on every invocation; cache by SQL string to avoid re-parsing
  - [REF] Batch `createJobs` deduplication/continuation checks — currently loops per-job with `findExistingContinuationSql`/`findDeduplicatedJobSql`, O(N) round-trips
  - [REF] Batch `addJobsBlockers` — currently 3-4 sequential queries per jobBlocker entry, O(N) round-trips
  - [REF] Better concurrency handling - WAL mode, busy timeout, retries
  - [REF] Separate read/write connection pools (single writer, multiple readers)
  - [REF] usage of db without pool is incorrect
  - [TASK,EASY] Validate `PRAGMA foreign_keys = ON` at adapter init (FK on `job_blocker.blocked_by_chain_id` requires it)
  - [TASK,EASY] get rid of skipConcurrencyTests flag in resilience tests (separate test suite?)
  - [REF] `deleteJobChains` race condition under WAL mode — check-then-delete without row locking; document single-writer assumption or use `BEGIN IMMEDIATE` transactions
- [EPIC] MySQL/MariaDB adapter
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
