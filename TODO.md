# Triage

- [?,REF] Research some analytic storage for jobs (in a separate readonly storage)
- [?,REF] Create some otel 'plugin' that reports information from state or andlytics storage
- [?,REF] Add input and output filtering

# Short term

- [REF] Standardize chain-ID parameter names across `Client`. Today the same concept is spelled three different ways depending on method: `id` on `getJobChain`/`deleteJobChain`/`triggerJob`/`completeJobChain`/`awaitJobChain`, `jobChainId` on `listJobChainJobs`/`listBlockedJobs`, and mixed `id`/`chainId` inside `listJobChains({ filter })` / `listJobs({ filter: { jobChainId } })`. Users have to memorize which key each method wants and autocomplete doesn't help disambiguate chain vs job ids. Pick one spelling (likely `chainId` at the filter level where a job id also appears, `id` where the chain is the sole subject) and migrate all methods in one breaking pass. See `design/chain-id-naming.md`
- [TASK] Get rid of 'for update' semantics that belong to postgres. Switch to something like 'lock: true'
- [TASK] Update lease in one operation (currently two: `getJobForUpdate` + `renewJobLease` in `commitLease`/`runInGuardedTransaction`). Collapse into a single guarded `UPDATE ... WHERE id=$1 AND leased_by=$2 AND status<>'completed' RETURNING *` and map zero rows to the existing `JobNotFoundError` / `JobTakenByAnotherWorkerError` / `JobAlreadyCompletedError` cases.

# Medium term

- [TASK] Fix flaky `handles transient database errors gracefully with multiple workers` test in state-resilience suite — fails intermittently in CI even with `--retry 2`; investigate root cause (timing-sensitive concurrent workers + injected errors)
- [EPIC] test against bun and its built-in sqlite, postgres, redis clients
- [TASK] Enforce json-serializable inputs and outputs (like no Date in job definitions) — see `design/json-serializable-types.md`
- [EPIC,COMPLEX] Batched processors — opt-in `batchLimit` on a processor; opportunistic batching (process up to N when available, never wait to accumulate). Array-shaped `attemptHandler({ jobs, prepare, complete })`, one prepare/complete per batch, group lease/complete/reap. Replaces the singular state-adapter methods with array-only counterparts. Open questions: `complete`/`continueWith` shape, group reaping, OTel mapping. See `design/batched-processors.md`
- [?,REF] For update locking in list methods (e.g. `listJobChainsForCleanup`), add option to skip locking when the method is used in a context where concurrent modifications are not a concern (e.g. cleanup job listing its own completed chains for deletion)
- [?,REF] Change complete job chain to something more empirical?
- [REVIEW] Review `addJobBlocker` design — see `design/add-job-blocker.md`
- [?,REF] Investigate uuid7 (to support PG partitioning) in a separate partitioned adapter
- [REF] Handle routing with seroval on dashboard instead of path-based routing (e.g. `/chains/${chainId}` → `/chain?chainId=${chainId}`) — simplifies dashboard API and allows more flexible UI patterns (modals, nested views)
- [TASK,COMPLEX] Better dashboard UI
- [TASK] Benchmark query performance (`listJobChains`, `listJobs`, `listJobChainJobs`, `listBlockedJobs`, `getJobChain`) across state adapters with seeded datasets — separate tool from `processing-capacity`, dimensions: dataset size, filter selectivity, page size
- [EPIC] Docs website enhancements
  - [TASK] Add interactive examples / live demos
  - [TASK] Custom branding and styling
- [REF] Reset jobs in chains + dashboard
- [EPIC,COMPLEX] SQLite production-readiness — concurrency model (WAL, busy_timeout, drop the `createAsyncRwLock` prescription), batched `createJobs`/`addJobsBlockers`, rewrite examples to production patterns + add multi-worker example, validate `PRAGMA foreign_keys` at init, drop `skipConcurrencyTests`. See `design/sqlite-ready.md`
- [EPIC] Built-in job priority — add `priority` field to job schema + secondary sort in acquisition query (composite index `(type_name, priority DESC, scheduled_at ASC) WHERE status = 'pending'`). Design decisions: starvation mitigation (aging? document footgun?), dedup + priority interaction (upgrade semantics when re-enqueuing existing dedup key at higher priority), chain priority inheritance, API surface on `createJob`/`triggerJob`. Backward compatible via `DEFAULT 0`
- [EPIC] MySQL/MariaDB adapter

# Long term

- [IDEA] MCP server
- [IDEA] Add OpenTelemetry logs support to @queuert/otel adapter (OTEL logs API is experimental)
- [IDEA] Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- [IDEA] Singletons/concurrency limit
- [IDEA] Partitioning (PG) - Scaling concern; defer until users hit limits
- [IDEA] Browser runtime support - SQLite WASM (OPFS) state adapter, Web Workers as job processors, BroadcastChannel notify adapter
