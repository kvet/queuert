# Triage

- [REF] Worker liveness. Move attempt ownership to worker. Have workers to be registered in the DB and have a heartbeat.
- [REF] Return back statuses. Get rid of continued substatus
- [REF] Move chain information to the head row

# Short term

- [EPIC] Chain identity. Closing [#3](https://github.com/kvet/queuert/issues/3). See `design/chain-identity.md`.
  - [TASK] List chains by identity — `listChains` gains an `identity` filter to page through the full recurrence history of a key
- [TASK] Built-in cleanup. See `design/builtin-cleanup.md`.
- [TASK] Enforce json-serializable inputs and outputs (like no Date in job definitions) — see `design/json-serializable-types.md`
- [TASK] Consolidate attempt abort events — we have lots silly API to maintain `JobAbortReason` into `HardJobAbortReason` (error-level: `taken_by_another_worker`, `not_found`, `already_completed`, `error`) and `SoftJobAbortReason` (`worker_stopping`).
- [TASK] Rework dashboard doc — UI views section and screenshots are stale after the type-first navigation redesign

# Medium term

- [EPIC] State-snapshot OTel gauges
- [EPIC] Unbounded blockers. See `design/unbounded-blockers.md`.
- [EPIC] how to cleanup chains with 1k+ jobs in a single transaction (SQLite WAL, PG lock footprint)? introduce truncateChainJobs?
- [EPIC,COMPLEX] Batched processors. See `design/batched-processors.md`
- [TASK] Unify workerless and worker tracing — workerless completion (`completeChain`) should create an attempt span like the worker path, eliminating the asymmetric `completeJobSpan` adapter method
- [EPIC] Align `@queuert/otel` with OpenTelemetry messaging semantic conventions
- [EPIC] SQLite production-readiness
  - [TASK] Get rid of `createAsyncRwLock()`
  - [TASK] No multi-worker example
  - [TASK] `PRAGMA foreign_keys = ON` is required for the `job_blocker.blocked_by_chain_id` FK but not validated at adapter init by default
  - [TASK] Promote transactions via a dedicated sentinel table (like migration lock in PG) to prevent WAL contention
- [TASK,COMPLEX] Better dashboard UI
- [EPIC] Docs website enhancements
  - [TASK] Add interactive examples / live demos
  - [TASK] Custom branding and styling
  - [?,REF] Sexy website
- [EPIC] MySQL/MariaDB adapter
- [EPIC] Test against bun and its built-in postgres, redis clients
  - [TASK] postgres-state example
  - [TASK] postgres-notify example
  - [TASK] redis-notify example

# Long term

- [IDEA] Built-in job priority
- [IDEA] expand the Chain type to have head and tail jobs for easy rescheduleJob knowing the chain id
- [IDEA] Change complete job chain to something more empirical? (leverages `lock: true` and rescheduleJob, new completeJob (maybe even some))
- [IDEA] Reset jobs in chains + dashboard
- [IDEA] Split dashboard into API and UI packages (to use the API in other contexts, e.g. CLI)
- [IDEA] CLI tool
- [IDEA] MCP server
- [IDEA] Add OpenTelemetry logs support to @queuert/otel adapter (OTEL logs API is experimental)
- [IDEA] Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- [IDEA] Singletons/concurrency limit
- [IDEA] Partitioned PG adapter
- [IDEA] Browser runtime support - SQLite WASM (OPFS) state adapter, Web Workers as job processors, BroadcastChannel notify adapter
