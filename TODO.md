# Triage

- [REF] transactionHooks provider
- [REF] sync sqlite api

# Short term

- [TASK] PostgreSQL REPEATABLE READ and SERIALIZABLE support — counter-based blocker bookkeeping (`has_dependents`, `blockers_remaining`) and Queuert-owned transactions pinned to READ COMMITTED. Ship with `002_worker_liveness` to keep one stop-the-world upgrade. See `design/pg-isolation-levels.md`.
- [TASK] Built-in cleanup. See `design/builtin-cleanup.md`.
- [TASK] Enforce json-serializable inputs and outputs (like no Date in job definitions) — see `design/json-serializable-types.md`
- [TASK] Reschedule reason and failure-streak backoff — persist `failure_streak` and the `complete({ reschedule, reason })` reason, compute backoff from the streak instead of `attempt`. See `design/reschedule-reason-and-backoff.md`.
- [EPIC] Decouple chain from jobs. See `design/chain-table.md`.
- [EPIC] Chain identity. Closing [#3](https://github.com/kvet/queuert/issues/3). See `design/chain-identity.md`.
  - [TASK] List chains by identity — `listChains` gains an `identity` filter to page through the full recurrence history of a key
- [TASK] Best-effort `rescheduleJobs` — today it fails the whole batch if any job is not pending, so apps hand-roll "wake a sleeping chain" loops (`listChainJobs` + `rescheduleJob` + catch `JobNotReschedulableError`). Add an option such as `skipNotReschedulable: true` that returns a per-job outcome (`rescheduled` / `not-pending` / `completed`) instead of throwing.

# Medium term

- [EPIC] State gauges — OTel gauges and dashboard signals (incl. stuck) from a periodic job-table snapshot. Direction only, depends on the reschedule-reason task. See `design/state-gauges.md`.
- [EPIC] Unbounded blockers. See `design/unbounded-blockers.md`.
- [EPIC] how to cleanup chains with 1k+ jobs in a single transaction (SQLite WAL, PG lock footprint)? introduce truncateChainJobs?
- [EPIC,COMPLEX] Batched processors. See `design/batched-processors.md`
- [TASK] Unify workerless and worker tracing — workerless completion (`completeChain`) should create an attempt span like the worker path, eliminating the asymmetric `completeJobSpan` adapter method
- [EPIC] Align `@queuert/otel` with OpenTelemetry messaging semantic conventions
- [EPIC] SQLite production-readiness
  - [TASK] Get rid of `createAsyncRwLock()`
  - [TASK] No multi-worker example
  - [TASK] Promote transactions via a dedicated sentinel table (like migration lock in PG) to prevent WAL contention
- [EPIC] MySQL/MariaDB adapter
- [TASK] Support numeric job and worker IDs — `TJobId` and `TWorkerId` extend `string`, so an `INTEGER`/`bigint` `jobIdType` or `workerIdType` is accepted by the adapters but its IDs still have to round-trip as strings. Allow `number`/`bigint` ID types end to end, including making the `State*` entity types (`StateJobInfo`, `StateChainInfo`, `StateJobBlockerInfo`, `StateWorkerInfo`, …) generic over `TJobId`/`TWorkerId` instead of using `string`.

# Long term

- [IDEA] Bring back the wake budget
- [IDEA] Built-in job priority
- [IDEA] expand the Chain type to have head and tail jobs for easy rescheduleJob knowing the chain id
- [IDEA] Change complete job chain to something more empirical? (leverages rescheduleJob, new completeJob (maybe even some))
- [IDEA] Reset jobs in chains + dashboard
- [IDEA] Split dashboard into API and UI packages (to use the API in other contexts, e.g. CLI)
- [IDEA] CLI tool
- [IDEA] MCP server
- [IDEA] Add OpenTelemetry logs support to @queuert/otel adapter (OTEL logs API is experimental)
- [IDEA] Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- [IDEA] Singletons/concurrency limit
- [IDEA] Partitioned PG adapter
- [IDEA] Browser runtime support - SQLite WASM (OPFS) state adapter, Web Workers as job processors, BroadcastChannel notify adapter
