# Triage

- [?,REF] Adopt dispose and asyncDispose
- [?,REF] Research some analytic storage for jobs (in a separate readonly storage)
- [?,REF] Create some otel 'plugin' that reports information from state or andlytics storage
- [?,REF] Get 'for update' semantics that belong to postgres. Switch to something like 'lock: true'
- [?,REF] Staged and atomic modes benchmark; verify that numbers look good

# Short term

- [TASK] Name internal types properly. No underscore. Add to code-style guide.
- [REF] Standardize chain-ID parameter names across `Client`. Today the same concept is spelled three different ways depending on method: `id` on `getJobChain`/`deleteJobChain`/`triggerJob`/`completeJobChain`/`awaitJobChain`, `jobChainId` on `listJobChainJobs`/`listBlockedJobs`, and mixed `id`/`chainId` inside `listJobChains({ filter })` / `listJobs({ filter: { jobChainId } })`. Users have to memorize which key each method wants and autocomplete doesn't help disambiguate chain vs job ids. Pick one spelling (likely `chainId` at the filter level where a job id also appears, `id` where the chain is the sole subject) and migrate all methods in one breaking pass.

# Medium term

- [EPIC] test against bun and its built-in sqlite, postgres, redis clients
- [TASK] Enforce json-serializable inputs and outputs (like no Date in job definitions) — see `design/json-serializable-types.md`
- [?,REF] Investigate uuid7 (to support PG partitioning) in a separate partitioned adapter
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
  - [REF] Hoist `getJobBlockers` out of the prepare-phase critical path — kick it off as a promise from the worker right after `acquireJob` returns, pass the promise into `runJobProcess`, await only when `runningJob.blockers` is consumed. Today the await is sequential right after acquire; moving it earlier costs nothing if the gap is sync, but unlocks parallelism for any future async work between acquire and blocker-use (and pairs naturally with a lazy `runningJob.blockers` getter for handlers that never read blockers — saves the RTT entirely in that case)
  - [REF] Merge acquire + initial lease into single operation — `acquireJob` already sets `status=running` but `renewJobLease` sets `leased_by`/`leased_until` separately
  - [REF] Batch completions in one transaction — amortize commit overhead for fast handlers
- [TASK,COMPLEX] Optimized batched lease renewal
- [EPIC] MCP server
- [EPIC] Sqlite ready:
  - [TASK,EASY] Add `example-state-sqlite-multi-worker` — mirror of `state-postgres-multi-worker` using sqlite (probably file-backed WAL so workers share a DB)
  - [REF] Batch `createJobs` deduplication/continuation checks — currently loops per-job with `findExistingContinuationSql`/`findDeduplicatedJobSql`, O(N) round-trips
  - [REF] Batch `addJobsBlockers` — currently 3-4 sequential queries per jobBlocker entry, O(N) round-trips
  - [REF] Better concurrency handling - WAL mode, busy timeout, retries
  - [REF] Separate read/write connection pools (single writer, multiple readers)
  - [REF] Stop prescribing `createAsyncRwLock` as the sqlite transaction model. Every sqlite example currently wires a shared async lock between the provider's `withTransaction` and user-initiated transactions on the same connection — because they share one `better-sqlite3`/`node:sqlite` connection and SQLite allows only one active tx per connection. This is boilerplate users rewrite (and get wrong: better-sqlite3 example had the lock split across instances, kysely example omits the lock on the user-side `db.transaction()` entirely — latent race). The provider contract is just "`withTransaction` gives exclusive atomic access"; how the user achieves that is their concern (pool, WAL + connection-per-tx, ORM-native transactions, etc.). Concretely:
    - Rewrite sqlite examples to show production-realistic patterns: file DB + `journal_mode=WAL` + `busy_timeout`, and either connection-per-transaction or a small pool. No `createAsyncRwLock` in user-facing code.
    - Remove/soften the docs prescription at `docs/src/content/docs/advanced/sqlite-internals.md` ("Custom `SqliteStateProvider` implementations must use `createAsyncRwLock()`") — describe the contract, not one implementation strategy.
    - Stop re-exporting `createAsyncRwLock` from `@queuert/sqlite` (or mark internal). Keeping it exported signals that it's part of the intended extension path.
  - [TASK,EASY] Validate `PRAGMA foreign_keys = ON` at adapter init (FK on `job_blocker.blocked_by_chain_id` requires it)
  - [TASK,EASY] get rid of skipConcurrencyTests flag in resilience tests (separate test suite?)
- [TASK] Fix flaky `handles transient database errors gracefully with multiple workers` test in state-resilience suite — fails intermittently in CI even with `--retry 2`; investigate root cause (timing-sensitive concurrent workers + injected errors)
  - [REF] `deleteJobChains` race condition under WAL mode — check-then-delete without row locking; document single-writer assumption or use `BEGIN IMMEDIATE` transactions
- [EPIC] MySQL/MariaDB adapter
- [EPIC] Built-in job priority — add `priority` field to job schema + secondary sort in acquisition query (composite index `(type_name, priority DESC, scheduled_at ASC) WHERE status = 'pending'`). Design decisions: starvation mitigation (aging? document footgun?), dedup + priority interaction (upgrade semantics when re-enqueuing existing dedup key at higher priority), chain priority inheritance, API surface on `createJob`/`triggerJob`. Backward compatible via `DEFAULT 0`
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
