# Triage

None

# Short term

- [EPIC] Worker liveness. Move attempt ownership to worker. Have workers to be registered in the DB and have a heartbeat. See `design/worker-liveness.md`.
- [EPIC] Chain identity. Closing [#3](https://github.com/kvet/queuert/issues/3). See `design/chain-identity.md`.
  - [TASK] List chains by identity — `listChains` gains an `identity` filter to page through the full recurrence history of a key
- [TASK] Built-in cleanup. See `design/builtin-cleanup.md`.
- [TASK] Enforce json-serializable inputs and outputs (like no Date in job definitions) — see `design/json-serializable-types.md`
- [TASK] Lost wake-up when attaching blockers — `lockBlockerChains` exclusively locks each blocker chain's head row until the creating transaction commits. Acquisition takes `FOR UPDATE OF j SKIP LOCKED`, locking only the job row, so a held head does not hold back the chain's later jobs; but when the pending job is the head itself (a single-job chain, or a chain still on its first job), a worker woken at that moment skips it and idles until the next poll. Re-notify locked pending blocker heads after commit. Drop the manual re-publish in `examples/showcase-blockers` once fixed.
- [TASK] `completeChain` can lock a stale current job on PostgreSQL — `completeChain` locks the chain's head, then locks `stateChain.tail` so a worker cannot acquire the current job while the handler runs. But `continueJobs` advances a chain without the head lock (it locks only the job it continues from), so a worker's `complete({ continueWith })` that commits while `completeChain` waits on the tail row hands the handler the now-completed old tail, and leaves the new tail unlocked for a worker to acquire. Lock the tail, then follow `continuedToId` and lock each next job until the locked job is not continued. Fix the comment there that claims the head lock keeps the tail from moving. Cover with a two-connection PostgreSQL spec.
- [TASK] Best-effort `rescheduleJobs` — today it fails the whole batch if any job is not pending, so apps hand-roll "wake a sleeping chain" loops (`listChainJobs` + `rescheduleJob` + catch `JobNotReschedulableError`). Add an option such as `skipNotReschedulable: true` that returns a per-job outcome (`rescheduled` / `not-pending` / `completed`) instead of throwing.
- [TASK] Attempt ownership check in user transactions — `complete` is fenced on the attempt, but intermediate writes a handler commits in its own transactions before `complete` (e.g. batched deletes) are not: they commit even after the attempt was lost. Add a primitive the handler can call inside any transaction it opens (e.g. `assertOwnership(txCtx)` on the handler options) that locks the job row under the attempt fence and throws `JobTakenByAnotherWorkerError` / `JobNotFoundError` / `JobAlreadyCompletedError` as a missed `complete` does, so those writes commit only while the attempt is still held.
- [TASK] Retry failed worker statements before giving up on the attempt — a heartbeat extension that fails with an unexpected error (e.g. a transient DB error) aborts the attempt's `signal` and stops extending at once, so the handler gives up or runs on without an extended attempt and can be reclaimed mid-run. Likewise, if the fallback reschedule after a failed attempt throws, the job stays `running` until its attempt expires. Retry each a few times within the attempt timeout before giving up.
- [TASK] Batched notify adapter methods — the notify adapter takes one type, chain or job per call, so a commit that schedules several types, completes several chains or loses several attempts, and a worker iteration that reclaims a batch of expired attempts, pay one round-trip per item, and two per scheduled type (`provideWakeHint` then `notifyJobScheduled`). Replace them with batched methods (e.g. `notifyJobsScheduled([{ typeName, count }])` that provides the hint and publishes in one call, `notifyChainsCompleted(chainIds)`, `notifyJobsAttemptLost(jobIds)`) and use them from `notify-hooks.ts` and the worker's reclaim path: one pipeline or Lua call on Redis, one `pg_notify` statement over `unnest` on PostgreSQL, one flush on NATS. Breaking for custom notify adapters; extend the notify conformance suite.
- [TASK] Skip `unblockJobs` for chains without dependents — `completeJobs` no longer returns `hasBlockedJobs`: on PostgreSQL its `EXISTS` on `job_blocker` reads the statement's snapshot, so it misses a blocker committed while the head UPDATE waited on the head lock. Every `{ output }` completion therefore pays for `unblockJobs` (two statements on PostgreSQL: `lockBlockedJobs` + `unblockJobs`). Store a sticky `chain_has_dependents` flag on the head row, set by `addJobsBlockers` under the head lock, and return it via `RETURNING` from the head UPDATE (which sees the latest row version after the wait), restoring the skip without a round-trip. Needs a migration that backfills the flag.
- [TASK] Reschedule reason and failure-streak backoff — persist `failure_streak` and the `complete({ reschedule, reason })` reason, compute backoff from the streak instead of `attempt`. See `design/reschedule-reason-and-backoff.md`.
- [EPIC] Decouple chain from jobs — chain state (`chain_status`, `chain_completed_at`, chain trace context) lives on the head job's row, so locking a chain locks its head job and locking the head job locks the chain. Every chain-level lock then behaves differently depending on whether the chain is still on its head job: a held blocker-chain head hides a pending head job from workers (the lost wake-up task), `completeChain` needs a separate job lock that only matters once the chain has moved past its head (its test must continue the chain first to prove anything), and `continueJobs` advances the chain without the chain lock, so the current job can move under a chain-lock holder (the stale current job task). Move chain state into its own `chain` table row with a `tail_job_id` pointer, updated under the chain row lock by `createJobs`/`continueJobs`/`completeJobs`, so a chain lock and a job lock never alias and the current job is read from the locked chain row. Would subsume the lost wake-up, stale current job and `chain_has_dependents` tasks. Needs a migration that backfills chain rows from head jobs.

# Medium term

- [EPIC] State gauges — OTel gauges and dashboard signals (incl. stuck) from a periodic job-table snapshot. Direction only, depends on the reschedule-reason task. See `design/state-gauges.md`.
- [EPIC] Unbounded blockers. See `design/unbounded-blockers.md`.
- [EPIC] how to cleanup chains with 1k+ jobs in a single transaction (SQLite WAL, PG lock footprint)? introduce truncateChainJobs?
- [EPIC,COMPLEX] Batched processors. See `design/batched-processors.md`
- [TASK] Unify workerless and worker tracing — workerless completion (`completeChain`) should create an attempt span like the worker path, eliminating the asymmetric `completeJobSpan` adapter method
- [EPIC] Align `@queuert/otel` with OpenTelemetry messaging semantic conventions
- [EPIC] SQLite production-readiness
  - [TASK] Sync client and attempt APIs — a `mode: "sync"` state adapter makes every state-touching client method, `complete` and workerless `completeChain` return plain values, so they run inside native synchronous SQLite transactions, and sync providers drop `AsyncRwLock`. See `design/sqlite-sync-api.md`.
  - [TASK] Get rid of `createAsyncRwLock()` — sync providers drop it with the sync API task; what is left is async providers
  - [TASK] No multi-worker example
  - [TASK] Promote transactions via a dedicated sentinel table (like migration lock in PG) to prevent WAL contention
- [EPIC] MySQL/MariaDB adapter

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
