# Short term

- [TASK] Server version checks for the notify adapters — the state adapters check their minimum in `migrateToLatest()`, but the Redis (6+) and NATS (2.2+) notify adapters have no migration step and check nothing. Check when the adapter first connects or subscribes, and throw the same `Unsupported <server> version <version>: Queuert needs <minimum> or later` error.

# Medium term

- [REF] PostgreSQL pipelining
- [TASK] Multi-process SQLite conformance — the SQLite conformance suites run every transaction on one `:memory:` connection, the async suite behind the in-process `AsyncRwLock` and the sync suite on one thread, so the `lock: "exclusive"` cases pass without exercising SQLite's own write lock. Add a mode that contends from a second connection in a worker thread or child process against a WAL file (better-sqlite3 blocks the event loop while it waits on `busy_timeout`, so both connections cannot share one thread).
- [TASK] Built-in cleanup. See `design/builtin-cleanup.md`.
- [TASK] Best-effort `rescheduleJobs` — today it fails the whole batch if any job is not pending, so apps hand-roll "wake a sleeping chain" loops (`listChainJobs` + `rescheduleJob` + catch `JobNotReschedulableError`). Add an option such as `skipNotReschedulable: true` that returns a per-job outcome (`rescheduled` / `not-pending` / `completed`) instead of throwing.
- [TASK] Reschedule reason and failure-streak backoff — persist `failure_streak` and the `complete({ reschedule, reason })` reason, compute backoff from the streak instead of `attempt`. See `design/reschedule-reason-and-backoff.md`.
- [EPIC] Decouple chain from jobs. See `design/chain-table.md`.
- [EPIC] Chain identity. Closing [#3](https://github.com/kvet/queuert/issues/3). See `design/chain-identity.md`.
  - [TASK] List chains by identity — `listChains` gains an `identity` filter to page through the full recurrence history of a key
- [TASK] Handle drivers whose transaction resolves after a rollback — knex resolves `knex.transaction(cb)` after a bare `trx.rollback()` (`doNotRejectOnRollback` defaults to `true`, per call and again for nested savepoints), so tx hooks flush for writes that never committed. Today users must pass `{ doNotRejectOnRollback: false }` on every call (see the knex section of `docs/src/content/docs/guides/tx-hooks.mdx`). Options: a knex helper that always sets the option, or a way for the hooks to learn the transaction's real outcome.
- [EPIC] State gauges — OTel gauges and dashboard signals (incl. stuck) from a periodic job-table snapshot. Direction only, depends on the reschedule-reason task. See `design/state-gauges.md`.
- [EPIC] Unbounded blockers. See `design/unbounded-blockers.md`.
- [EPIC] how to cleanup chains with 1k+ jobs in a single transaction (SQLite WAL, PG lock footprint)? introduce truncateChainJobs?
- [EPIC,COMPLEX] Batched processors. See `design/batched-processors.md`
- [TASK] Unify workerless and worker tracing — workerless completion (`completeChain`) should create an attempt span like the worker path, eliminating the asymmetric `completeJobSpan` adapter method
- [EPIC] Align `@queuert/otel` with OpenTelemetry messaging semantic conventions
- [EPIC] Redis state adapter performance and open problems — claim cache, fewer index updates, lock-wait divergences, notify latency. See `design/redis-state-adapter-performance.md`.
- [TASK] PostgreSQL REPEATABLE READ and SERIALIZABLE. See `design/pg-isolation-levels.md`.
- [TASK] MySQL/MariaDB REPEATABLE READ and SERIALIZABLE. See `design/mysql-isolation-levels.md`.
- [EPIC] MongoDB adapter. See `design/mongodb-adapter.md`.
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
- [IDEA] Ship an agent skill in the npm package — like `arktype@2.2.9`, which publishes `skills/arktype/SKILL.md` via `files`, so installing it shows an "agent skills awaiting approval" prompt (`pnpm approve`). A `queuert` skill could cover defining job types, chains, workers and adapter setup, and link to the docs site.
- [IDEA] Add OpenTelemetry logs support to @queuert/otel adapter (OTEL logs API is experimental)
- [IDEA] Hard timeout (worker threads) - True isolation with `terminate()`; enables memory limits and untrusted code sandboxing
- [IDEA] Singletons/concurrency limit
- [IDEA] Partitioned PG adapter
- [IDEA] Browser runtime support - SQLite WASM (OPFS) state adapter, Web Workers as job processors, BroadcastChannel notify adapter
