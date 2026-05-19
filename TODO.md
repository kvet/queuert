# Triage

- [?,REF] Add input and output filtering
- [?,REF] Add a method to attempt handler to create a transaction mid run that run guarded check
- [?,REF] Change complete job chain to something more empirical?
- [?,REF] Reset jobs in chains + dashboard
- [?,REF] Allow worker stopping signal to be risen in attempt handler

# Short term

- [EPIC] Align implementation with `design/job-model.md` — rename `has_blockers` → `has_open_blockers`, rename `continued_to_job_id` → `succeeded_by_job_id`, expand `JobStatus` from 4 values to 6 (`blocked` / `scheduled` / `ready` / `running` / `continued` / `completed`) as a discriminated union with `openBlockerChainIds` on the blocked variant, add `last_user_reschedule_attempt int NULL`, rename `ChainStatus` to `'open' | 'closed'`, add `UNIQUE (chain_id) WHERE succeeded_by_job_id IS NULL` partial, rebuild dashboard listing partials to match the new derivation. Migration is mostly column/index renames + one additive column. See `design/job-model.md` for the spec and `design/job-model.md#migration-from-current-state` for the delta list.
- [TASK] Enforce json-serializable inputs and outputs (like no Date in job definitions) — see `design/json-serializable-types.md`
- [EPIC,COMPLEX] SQLite production-readiness — concurrency model (WAL, busy_timeout, drop the `createAsyncRwLock` prescription), batched `createJobs`/`addJobsBlockers`, rewrite examples to production patterns + add multi-worker example, validate `PRAGMA foreign_keys` at init, drop `skipConcurrencyTests`. See `design/sqlite-ready.md`
- [EPIC] State-snapshot OTel gauges — opt-in `@queuert/otel-state` package emitting `open_jobs/chains{type,status}`, `oldest_ready_job/chain_age_seconds{type}`, `stuck_jobs/chains{type}` from a periodic metrics chain (cleanup-style). Builds on `design/job-model.md` (which provides the derived `status`, the structural columns, and `last_user_reschedule_attempt`); adds one metrics-specific partial index (`job_stuck_idx`) and a `getMetricsSnapshot` adapter method. Open questions: single-runner snapshot distribution (DB-stored vs per-process), default stuck threshold. See `design/state-snapshot-metrics.md`. **Depends on `design/job-model.md` implementation.**
- [EPIC] Built-in job priority — add `priority INTEGER NOT NULL DEFAULT 0` to the job schema + replace acquisition index with expression index `(type_name, (priority - attempt) DESC, scheduled_at ASC) WHERE has_open_blockers = false AND leased_until IS NULL AND completed_at IS NULL` (predicate inherited from `job-model.md`). Linear demotion via `priority - attempt` in v1; wall-clock aging deferred to v2. Design decisions settled in `design/job-priority.md`: numeric (not named tiers), dedup keeps existing-priority, `continueWith` inherits parent's priority, `getNextJobAvailableInMs` stays priority-blind. Additive on top of `design/job-model.md`. **Depends on `design/job-model.md` implementation.**
- [EPIC,COMPLEX] Batched processors — opt-in `batchLimit` on a processor; opportunistic batching (process up to N when available, never wait to accumulate). Array-shaped `attemptHandler({ jobs, prepare, complete })`, one prepare/complete per batch, group lease/complete/reap. Replaces the singular state-adapter methods with array-only counterparts. Open questions: `complete`/`continueWith` shape, group reaping, OTel mapping. See `design/batched-processors.md`

# Medium term

- [TASK] Surface caller-supplied job ID collisions as a typed error (e.g. `DuplicateJobIdError`) at the state-adapter boundary. Today, passing an `id` to `startChain` / `startChains` / `continueWith` that already exists (and doesn't hit a dedup path) fails with the raw underlying DB error (PG unique-violation, SQLite `SQLITE_CONSTRAINT_PRIMARYKEY`). Catch in the PG and SQLite adapters and rethrow as a typed error to match the rest of the package's error vocabulary (see `InvalidJobIdError`). Also consider validating intra-batch duplicate IDs upfront so the in-process adapter doesn't silently overwrite while the SQL adapters reject.
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
