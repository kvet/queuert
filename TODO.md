# Triage

- [?,REF] Add input and output filtering
- [?,REF] Add a method to attempt handler to create a transaction mid run that run guarded check
- [?,REF] Change complete job chain to something more empirical?
- [?,REF] Reset jobs in chains + dashboard
- [?,REF] Review how `blocked → running` jobs get scheduled — currently they appear to jump in front of everything else once unblocked. May be fine, but needs to be reviewed (fairness vs. chain progress vs. priority interaction).

# Short term

- [TASK] Switch migrations to a maintenance-window model (advisory-locked single-runner, schema → batched backfill → drop defaults → concurrent indexes). Lets us drop the rolling-deploy carve-outs in changesets (e.g. the `continuedToJobId` backfill caveat, the `has_blockers` "old worker forward-safe" note). See `design/maintenance-window-migrations.md`
- [REVIEW] `completeJob` and `renewJobLease` lack status/leasedBy guards — a worker whose lease was reaped can still complete (overwriting a fresh retry attempt) or renew (resurrecting a dead row back to `running`). Affects PG (`packages/postgres/src/state-adapter/sql.ts:622-639,827-841`) and SQLite (`packages/sqlite/src/state-adapter/sql.ts:624-641,881-895`). Verify with a focused test before adding `WHERE status = 'running' AND leased_by = $workerId` guards and surfacing "lease lost" at the adapter boundary.
- [TASK] Enforce json-serializable inputs and outputs (like no Date in job definitions) — see `design/json-serializable-types.md`
- [TASK] Cap the number of blockers per job (proposed: 1k). Today the limit is implicit — `getJobBlockers` is documented "not paginated, bounded by design", attempt handlers materialize the full `blockers: [...]` list with all outputs every run, and `addJobsBlockers` batches in one transaction. Pick a hard limit, validate at `createJobs`/`addJobsBlockers`, surface a typed error, and document it. Lets us keep `hasBlockers` as a boolean (no count column needed) and bounds attempt-context memory.
- [EPIC,COMPLEX] SQLite production-readiness — concurrency model (WAL, busy_timeout, drop the `createAsyncRwLock` prescription), batched `createJobs`/`addJobsBlockers`, rewrite examples to production patterns + add multi-worker example, validate `PRAGMA foreign_keys` at init, drop `skipConcurrencyTests`. See `design/sqlite-ready.md`
- [EPIC] State-snapshot OTel gauges — opt-in `@queuert/otel-state` package emitting `incomplete_jobs/chains{type,status}`, `oldest_pending_job/chain_age_seconds{type}`, `stuck_jobs/chains{type}` from a periodic metrics chain (cleanup-style). Adds `attempts_since_reschedule` int column to track retries that aren't progressing via user `rescheduleJob`, three partial indexes over the active working set, and a `getMetricsSnapshot` adapter method. Open questions: single-runner snapshot distribution (DB-stored vs per-process), default stuck threshold. See `design/state-snapshot-metrics.md`
- [EPIC] Built-in job priority — add `priority` field to job schema + secondary sort in acquisition query (composite index `(type_name, priority DESC, scheduled_at ASC) WHERE status = 'pending'`). Design decisions: starvation mitigation (aging? document footgun?), dedup + priority interaction (upgrade semantics when re-enqueuing existing dedup key at higher priority), chain priority inheritance, API surface on `createJob`/`triggerJob`. Backward compatible via `DEFAULT 0`
- [EPIC,COMPLEX] Batched processors — opt-in `batchLimit` on a processor; opportunistic batching (process up to N when available, never wait to accumulate). Array-shaped `attemptHandler({ jobs, prepare, complete })`, one prepare/complete per batch, group lease/complete/reap. Replaces the singular state-adapter methods with array-only counterparts. Open questions: `complete`/`continueWith` shape, group reaping, OTel mapping. See `design/batched-processors.md`
- [EPIC] Marketing surface — visual / social-proof assets (Phase 2 of the May 2026 docs reframe)
  - [TASK] Update GitHub repo description + topics to match the new tagline ("Type-safe multi-step workflows that commit with your Postgres transactions") — currently still aligned with the old "control flow library" framing
  - [TASK] Architecture diagram on docs landing page (one PNG/SVG showing client + worker + state adapter + notify adapter against your DB)
  - [TASK] Type-safety GIF or screenshot demonstrating `continueWith` lighting up a wrong-shape compile error in VS Code — surface in README and docs landing
  - [TASK] Dashboard screenshot in `docs/src/content/docs/integrations/dashboard.mdx` and `docs/src/content/docs/reference/dashboard.md`
  - [TASK] Verify and surface "0 runtime deps" claim if true (check `packages/core/package.json` dependencies are empty); if not, document what runtime deps each package brings
  - [TASK] "Used in production by" section on README + docs landing once there's something to put there
  - [TASK] Surface test count on README (badge or sentence) once it's a number worth quoting

# Medium term

- [?,REF] For update locking in list methods (e.g. `listChainsForCleanup`), add option to skip locking when the method is used in a context where concurrent modifications are not a concern (e.g. cleanup job listing its own completed chains for deletion)
- [REVIEW] Review dynamic-blockers design — typed prep phase that lets a job decide at runtime what to wait on, with blockers' types still driven by the static `blockers: [...] as const` menu (creation-time vs prep-time invisible to the main handler). See `design/dynamic-blockers.md`
- [REF] Handle routing with seroval on dashboard instead of path-based routing (e.g. `/chains/${chainId}` → `/chain?chainId=${chainId}`) — simplifies dashboard API and allows more flexible UI patterns (modals, nested views)
- [TASK,COMPLEX] Better dashboard UI
- [TASK] Benchmark query performance (`listChains`, `listJobs`, `listChainJobs`, `listBlockedJobs`, `getChain`) across state adapters with seeded datasets — separate tool from `processing-capacity`, dimensions: dataset size, filter selectivity, page size
- [EPIC] Docs website enhancements
  - [TASK] Add interactive examples / live demos
  - [TASK] Custom branding and styling
- [EPIC] MySQL/MariaDB adapter

# Long term

- [EPIC,BLOCKED] test against bun and its built-in postgres, redis clients — blocked by https://github.com/oven-sh/bun/issues/21342 (testcontainers hangs under Bun, preventing on-demand container provisioning in examples and conformance specs)
  - [TASK] postgres-state example
  - [TASK] postgres-notify example
  - [TASK] redis-notify example
- [IDEA] MCP server
- [IDEA] Add OpenTelemetry logs support to @queuert/otel adapter (OTEL logs API is experimental)
- [IDEA] Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- [IDEA] Singletons/concurrency limit
- [IDEA] Partitioning (PG) - Scaling concern; defer until users hit limits
- [IDEA] Browser runtime support - SQLite WASM (OPFS) state adapter, Web Workers as job processors, BroadcastChannel notify adapter
