# Triage

None

# Short term

- [EPIC] Worker liveness. Move attempt ownership to worker. Have workers to be registered in the DB and have a heartbeat. See `design/worker-liveness.md`.
- [EPIC] Chain identity. Closing [#3](https://github.com/kvet/queuert/issues/3). See `design/chain-identity.md`.
  - [TASK] List chains by identity — `listChains` gains an `identity` filter to page through the full recurrence history of a key
- [TASK] Built-in cleanup. See `design/builtin-cleanup.md`.
- [TASK] Enforce json-serializable inputs and outputs (like no Date in job definitions) — see `design/json-serializable-types.md`
- [TASK] Lost wake-up when attaching blockers — `lockBlockerChains` exclusively locks each blocker chain's head row, and acquisition takes `FOR UPDATE OF h, j SKIP LOCKED`, so a worker woken at that moment skips the chain's pending job and idles until the next poll. User-owned transactions (`feature/user-owned-transactions`) acquire with `FOR UPDATE OF j` only, which fixes it when the pending job is not the head; a pending head job (single-job chain, or a chain still on its first job) is still skipped, so re-notify locked pending blocker heads after commit. Drop the manual re-publish in `examples/showcase-blockers` once fixed. That branch also fixes the example's lock order: today `complete` locks the job/chain head before the processor locks the order, while shipping locks the order first, so the two can deadlock; there `finish` locks the job last.
- [TASK] Best-effort `rescheduleJobs` — today it fails the whole batch if any job is not pending, so apps hand-roll "wake a sleeping chain" loops (`listChainJobs` + `rescheduleJob` + catch `JobNotReschedulableError`). Add an option such as `skipNotReschedulable: true` that returns a per-job outcome (`rescheduled` / `not-pending` / `completed`) instead of throwing.
- [TASK] Heartbeat failure poisons the attempt — when renewing the attempt fails with an unexpected error (e.g. a transient DB error), the worker hard-aborts and every later `step` / `complete`, including the error path that would reschedule, rethrows that error. The attempt can then neither be saved nor rescheduled and waits for reclaim after it expires. Revisit whether to rethrow at all (e.g. let the next guarded transaction refetch and decide).
- [TASK] `reason` on `finish({ reschedule })` — let handlers pass a short reason string that is recorded on the attempt span and logs, so apps stop logging "Rescheduling job" by hand.

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
  - [TASK] Promote transactions via a dedicated sentinel table (like migration lock in PG) to prevent WAL contention
- [EPIC] MySQL/MariaDB adapter
- [EPIC] Test against bun and its built-in postgres, redis clients
  - [TASK] postgres-state example
  - [TASK] postgres-notify example
  - [TASK] redis-notify example

# Long term

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
