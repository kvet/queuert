# Short term

- [TASK] Batch variants for the remaining client errors — a batch call reports only the first offending item for `JobTypeValidationError`, `ChainNotFoundError` (blockers), `BlockerLimitExceededError`, `InvalidJobIdError` and the like, while not-found, already-completed, status and type mismatches list every id. Add `Jobs*` / `Chains*` variants and map them back in the single-item methods with `toSingleJobError` / `toSingleChainError`. Attempt-side errors (`JobAttemptReclaimedError`, `JobTakenByAnotherWorkerError`) get batch variants with batched processors.
- [TASK] `awaitChain` takes one options object like `applyJobOutcome` — `awaitChain({ chain, timeoutMs, pollIntervalMs?, signal? })` with an exported `ChainRef = { id, typeName? }` mirroring `JobRef`, instead of `awaitChain(chain, options)`. About 330 call sites across tests, examples and docs; TypeScript 7 has no JS compiler API, so a codemod needs `oxc-parser`.
- [TASK] `client.awaitChains` — batch variant of `awaitChain` that waits for several chains with one listener and one poll per tick, returning the completed chains in input order, instead of apps running `Promise.all` over `awaitChain`.
- [TASK] Unify workerless and worker tracing — client completion (`applyJobOutcome` with `output` or `continueWith`) should create an attempt span like the worker path, eliminating the asymmetric `completeJobSpan` adapter method
- [TASK] Failing and overdue. See `design/failing-and-overdue.md`.
- [TASK] State gauges. See `design/state-gauges.md`.
- [EPIC] Row locks. See `design/row-locks.md`.
- [EPIC] Redis state adapter performance and open problems. See `design/redis-state-adapter-performance.md`.
- [EPIC] MongoDB adapter. See `design/mongodb-adapter.md`.

# Medium term

- [TASK] Built-in cleanup. See `design/builtin-cleanup.md`.
- [EPIC] Chain identity. Closing [#3](https://github.com/kvet/queuert/issues/3). See `design/chain-identity.md`.
  - [TASK] List chains by identity — `listChains` gains an `identity` filter to page through the full recurrence history of a key
- [EPIC] Unbounded blockers. See `design/unbounded-blockers.md`.
- [EPIC] how to cleanup chains with 1k+ jobs in a single transaction (SQLite WAL, PG lock footprint)? introduce truncateChainJobs?
- [EPIC,COMPLEX] Batched processors. See `design/batched-processors.md`
- [EPIC] Align `@queuert/otel` with OpenTelemetry messaging semantic conventions

# Long term

- [IDEA] PostgreSQL pipelining
- [IDEA] Bring back the wake budget
- [IDEA] Built-in job priority
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
