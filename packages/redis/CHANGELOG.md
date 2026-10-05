# @queuert/redis

## 0.16.0

### Major Changes

- da06e7d: Redesign the job model around the head row: a chain's head row _is_ the chain, and the chain's own facts — type name, status, deduplication key, trace context and completion time — live on that row and are written when the chain ends rather than inferred from its latest job. This is a breaking schema change that replaces the job tables: the database must already be at v0.15.1. On PostgreSQL, `migrateToLatest()` copies the tables while v0.15.1 workers keep running and blocks them only for a final swap that verifies the copy, which takes roughly a second per million jobs; on SQLite, all workers and clients must be stopped while it runs.

  - `ChainStatus` drops `"blocked"` and `"pending"`, leaving `"running" | "completed"`; a chain is running until its tail job completes terminally, and only the `completed` variant of `Chain` carries `output` and `completedAt`. Job status is unchanged (`blocked` stays a job status).
  - Completed jobs carry `continuedToId`: `null` with `output` when the job ended its chain, the successor's id (and no `output`) when it continued.
  - The running `Job` variant replaces the optional `leasedBy` / `leasedUntil` with `attemptAt` (when the current attempt started), `attemptBy` and `attemptUntil`.
  - Lease terminology becomes attempt terminology: `leaseConfig` → `attemptConfig` on processors and worker defaults (`leaseMs` → `timeoutMs`, `renewIntervalMs` → `heartbeatMs`; type `LeaseConfig` → `AttemptConfig`); log events `job_attempt_lease_expired` / `job_attempt_lease_renewed` / `job_reaped` → `job_attempt_expired` / `job_attempt_extended` / `job_attempt_reclaimed`; OTEL metrics `queuert.job.attempt.lease_expired` / `queuert.job.attempt.lease_renewed` / `queuert.job.reaped` → `queuert.job.attempt.expired` / `queuert.job.attempt.extended` / `queuert.job.attempt.reclaimed`.
  - `listChains`, `listJobs` and `listChainJobs` take flat options with a single `status` string instead of a `filter` object with arrays, and `orderBy` is status-dependent and checked at compile time (e.g. running jobs by `attemptAt` or `attemptUntil`, completed jobs and chains by `completedAt`). `root` is renamed `independent` on `listChains`, `listChainJobs` takes `chainTypeName` instead of `typeName`, its cursors are opaque, and `CreatedAtCursor` is renamed `TimestampWithIdCursor`.
  - Deduplication `scope` is now required, and `"incomplete"` is renamed `"running"`; a missing `scope` (previously defaulting to `"incomplete"`) or an unknown one now throws a `TypeError` at runtime.
  - Fix a race where a job created with `blockers` while a blocker chain was being continued in another transaction started as `pending` instead of `blocked`; the blocker check now reads the chain's status from its locked head row ([#4](https://github.com/kvet/queuert/issues/4)).
  - The dashboard follows the model: the chain status filter offers only running and completed.
  - Concurrent `migrateToLatest()` calls are safe across processes: PostgreSQL serializes them through a new single-row `{tablePrefix}migration_lock` table (SQLite relies on its single writer).
  - The migration history collapses to a single `001_initial_schema` migration that fresh installs and upgrades run alike; the 0.15.x records are removed from `{tablePrefix}migration`, and on PostgreSQL the `{tablePrefix}job_status` enum is dropped.
  - Schema: the job table is rebuilt with chain facts on the head row (`chain_status`, `chain_completed_at`, `chain_deduplication_key`), `continued_to_id` and `attempt_at` added, `leased_*` renamed `attempt_*`, `status` as `text` with a CHECK constraint, and job/blocker foreign keys dropped; indexes are replaced by one partial index per status. See the PostgreSQL and SQLite internals docs for the full layout.

### Minor Changes

- Queuert 0.16 rebuilds the job model around the chain's head row and reworks attempt handling around a single `finish` outcome API, with a one-step schema migration from v0.15.1. It also brings faster listing queries, a redesigned dashboard, and a leaner, more consistent public API. This release contains many breaking changes — review the upgrade notes before migrating.

### Patch Changes

- Updated dependencies [0719785]
- Updated dependencies [09f353d]
- Updated dependencies [24ff428]
- Updated dependencies [a44004b]
- Updated dependencies [a1e6c1a]
- Updated dependencies [67833e1]
- Updated dependencies [24ff428]
- Updated dependencies [dc5a2b8]
- Updated dependencies [e7dd362]
- Updated dependencies [314fe95]
- Updated dependencies [7cb4d94]
- Updated dependencies [da06e7d]
- Updated dependencies [23ed227]
- Updated dependencies
- Updated dependencies [63e0378]
- Updated dependencies [c2a4fe0]
- Updated dependencies [24ff428]
- Updated dependencies [ca681b1]
- Updated dependencies [63aa316]
  - queuert@0.16.0

## 0.15.1

### Patch Changes

- f7194ab: Fix a worker busy-loop and make Postgres job acquisition use the acquisition index. A worker whose slots were all busy kept polling the state adapter as fast as the event loop allowed: with a due job in the backlog the poll reported `0ms`, so the wait returned immediately and the worker re-entered the loop without being able to take work. Saturated workers now wait for a slot to free instead of polling. Separately, the Postgres `acquireJob` and `getNextJobAvailableInMs` queries matched jobs with `type_name IN (...)` and ordered by `scheduled_at`, which Postgres cannot satisfy from the `(type_name, scheduled_at)` acquisition index for more than one job type — it fell back to scanning and sorting the entire pending backlog on every acquisition and every poll. Both queries now look up each job type separately so the index is used, turning a scan of the backlog into one index lookup per job type. Workers polling a large Postgres backlog should see a substantial drop in database load.
  - Saturated in-process workers no longer poll `getNextJobAvailableInMs`; they wake when a slot frees or after `pollIntervalMs`
  - Postgres `acquireJob` / `getNextJobAvailableInMs` rewritten as per-job-type `LATERAL` lookups
  - On Postgres, when several job types are polled together, acquisition now picks a job type at random and takes its oldest due job, rather than always taking the globally oldest job; this keeps a backlogged job type from starving the others
  - Postgres `getNextJobAvailableInMs` no longer takes row locks on jobs scheduled in the future

- Updated dependencies [f7194ab]
  - queuert@0.15.1

## 0.15.0

### Patch Changes

- Updated dependencies [f5b7f9d]
- Updated dependencies [af22109]
- Updated dependencies [082650f]
- Updated dependencies [02b2167]
  - queuert@0.15.0

## 0.14.1

### Patch Changes

- ee13b9a: Conformance fixture cleanup. `StateConformanceFixture` now propagates `generateId` and `generateInvalidId` through to the cases — previously the runner only forwarded `stateAdapter` and `poisonTransaction`, so adapters configured with a custom `validateId` could not exercise the caller-supplied `id` path. As part of the fix, the separate `StateAdapterConformanceContext` and `NotifyAdapterConformanceContext` types were collapsed into `StateConformanceFixture` / `NotifyConformanceFixture` so a future field addition cannot be silently dropped at the fixture↔context bridge.
  - Added `generateId?: () => string` and `generateInvalidId?: () => string` to `StateConformanceFixture`; `runStateAdapterConformance` now forwards them.
  - Removed `StateAdapterConformanceContext` and `NotifyAdapterConformanceContext`. Callers that referenced these types (e.g. `it.extend<NotifyAdapterConformanceContext>(...)` in vitest specs) should switch to `StateConformanceFixture` / `NotifyConformanceFixture`.

- Updated dependencies [ee13b9a]
  - queuert@0.14.1

## 0.14.0

### Patch Changes

- Updated dependencies [66a3c9c]
- Updated dependencies [956bbd3]
- Updated dependencies [3da743c]
- Updated dependencies [0fd8d55]
- Updated dependencies [673d669]
  - queuert@0.14.0

## 0.13.0

### Minor Changes

- Add worker-level defaults and required cross-slice middleware, restore composition of multiple external slices for validation adapters, tighten public error class fields, align `@queuert/otel` metric attributes with OpenTelemetry semantic conventions, and make `executeSql.id` uniquely identify the resolved SQL so custom state providers can cache prepared statements by id alone.

  **Features:**
  - `createInProcessWorker`: new `defaults: { backoffConfig?, leaseConfig? }` option for fleet-wide fallbacks (resolution: processor → registry → worker `defaults` → library default), plus `InProcessWorkerDefaults` exported from the package root.
  - `createInProcessWorker`: new `requiredAttemptMiddleware` tuple enforces (at compile time against the merged slice middleware, and at runtime by reference identity) that every slice includes the listed `AttemptMiddleware` instances as an in-order subsequence. The worker does not execute them itself — this guarantees cross-cutting concerns (auth, tracing, logging) are wired into every slice without giving up the per-slice middleware model.
  - Validation adapters now accept either a single external slice or a `readonly` array, restoring the multi-slice composition path that was removed alongside `mergeJobTypeRegistries` in 0.12. New public `JobTypesDefinitions<T>` resolves either form to the merged `BaseJobTypeDefinitions` record.
  - `@queuert/postgres` and `@queuert/sqlite` re-export `RuntimeType` so custom state-provider authors can type their serialization/parsing without reaching into `@queuert/typed-sql`.
  - New `state-sqlite-bun` example demonstrates `@queuert/sqlite` running on `bun:sqlite`.

  **Breaking:**
  - `createInProcessWorker`: `workerId` option renamed to `workerName` — an optional human-readable label restricted to `/^[A-Za-z0-9._-]+$/`. The runtime always appends a random UUID to produce the final worker id (`${workerName}-${uuid}`, or just `${uuid}` when omitted), making duplicate worker ids impossible to express. Observability events and error fields continue to expose the full id under `workerId`.
  - Validation adapter signatures accept the "single slice or readonly array" shape `createClient` already takes; `ExternalJobTypeDefinitions` is no longer exported (use `JobTypeDefinitions` for a single slice or `JobTypesDefinitions` for either form). Adapter authors implementing `runValidationAdapterConformance` must add a `buildWithExternalSlices` fixture, and `buildWithExternalSlice`'s `blockers` tightens from a readonly array to a tuple — schemas under test must switch from `array(...)` to `tuple([...])` (`z.tuple`, `v.tuple`, `Type.Tuple`, `type([...])`).
  - Public error classes (`JobNotFoundError`, `ChainNotFoundError`, `JobTakenByAnotherWorkerError`, `JobAlreadyCompletedError`, `JobNotTriggerableError`, `WaitChainTimeoutError`) have their contextual fields (`jobId`, `chainTypeName`, etc.) tightened to non-optional `string` / `number`, and constructor options promoted from optional to required — caught errors no longer need null-checks. `JobTakenByAnotherWorkerError.leasedBy` is now `string | null` (an omitted constructor option is normalized to `null`); narrowings via `=== undefined` should switch to `=== null`.
  - `@queuert/otel`: every metric attribute key renamed to OpenTelemetry semantic-convention style (lowercase, dotted) to align with the span attributes already emitted by the tracing layer. Metric _names_ are unchanged, so queries still resolve — but dashboards, alerts, and recording rules that group by or filter on the old keys silently return empty results until updated. `workerId` → `queuert.worker.id`, `typeName` → `queuert.job.type`, `chainTypeName` → `queuert.chain.type`, `continued` → `queuert.job.continued`, `operation` → `queuert.adapter.operation`. Two value encodings also changed on `queuert.job.completed`: `queuert.job.continued` is now a real boolean (not `"true"` / `"false"`), and `queuert.worker.id` is omitted for workerless completions (no longer the literal string `"null"`).
  - `@queuert/postgres` and `@queuert/sqlite`: `executeSql`'s `id` now uniquely identifies the resolved SQL within a provider — the template applier folds variants like `schema` / `tablePrefix` into a hashed suffix. The built-in `pg.Pool` provider drops its SHA1 name-hash (`query.name = id`); built-in `better-sqlite3` and `node:sqlite` providers drop their per-database SQL→Statement maps and key the cache by `id`. Custom providers can do the same.

  **Fixes:**
  - Relax the generic bound on `AttemptMiddleware`'s `TStateAdapter` from `StateAdapter<BaseTxContext, any>` to `StateAdapter<any, any>`. The previous bound was unusable in practice: because the transaction-context type parameter appears in contravariant positions, no concrete adapter with a non-empty `txCtx` could satisfy `StateAdapter<BaseTxContext = {}, any>`. Adapter-aware middleware and generic test helpers now type-check without `any` workarounds.

### Patch Changes

- Updated dependencies
  - queuert@0.13.0

## 0.12.0

### Major Changes

- Restructure registries around composable slices, drop the `Job` prefix from chain naming across the public surface, add adapter `close()` lifecycle, split wake-hint budgets out of `notifyJobScheduled`, run pure-`SELECT` queries concurrently via `AsyncRwLock`, replace dedicated FOR-UPDATE getters with a `lock` option on the existing getters, run transaction-hook `flush`/`discard` concurrently for measurable throughput gains across every adapter, and cache prepared statements via an optional `id` on `TypedSql`. A schema migration `20260430000000_rename_chain_indexes` runs automatically via `migrateToLatest()` (Postgres uses `ALTER INDEX RENAME`; SQLite drops + recreates).

  **Features:**
  - Onion-style `AttemptMiddleware` (`wrapHandler` / `wrapPrepare` / `wrapComplete`) lets middleware wrap each phase of an attempt and inject typed context; chains run per-`Processors` slice instead of worker-wide.
  - Concurrent `SELECT` reads (`AsyncRwLock`) and concurrent transaction-hook flush — end-to-end throughput improves on every adapter (e.g. SQLite better-sqlite3 ~7.2k → ~8.4k jobs/s; Postgres pg notify ~1.5k → ~1.9k jobs/s).
  - Prepared-statement caching: pass `id` to `sql()` to enable per-statement preparation in built-in providers (postgres.js `prepare: true`, pg `query.name`, SQLite `db.prepare` cache).
  - `runValidationAdapterConformance` conformance runner exported from `queuert/conformance` for validation-adapter authors.
  - `UnknownJobTypeError` raised by merged `JobTypes` when a referenced type name isn't owned by any slice.

  **Breaking:**
  - Slice model: `JobTypeRegistry` / `JobTypeProcessorRegistry` → `JobTypes` / `Processors`. `createClient` / `createInProcessWorker` accept a single slice or array of slices; merge helpers (`mergeJobTypeRegistries`, `mergeJobTypeProcessorRegistries`) removed.
  - Middleware: `JobAttemptMiddleware` → `AttemptMiddleware`; lives on the `Processors` slice (`createProcessors({ attemptMiddleware })`).
  - Worker options: `pollIntervalMs` is top-level on `createInProcessWorker`; per-type `backoffConfig` / `leaseConfig` move onto `createProcessors`; the old worker-loop `backoffConfig` is renamed to `recoveryBackoffConfig`.
  - Chain naming: drop `Job` prefix everywhere — types (`Chain`, `ChainStatus`, `ChainNotFoundError`, `ChainData`), client methods (`startChain(s)`, `getChain`, `awaitChain`, `listChains`, `listChainJobs`, `completeChain`, `deleteChain(s)`), notify/observability events, log entry types and messages, and OTEL metrics (`queuert.chain.*`). Drop `ById` suffix on `StateAdapter` getters (`getJob`, `getChain`, `listChains`, `listChainJobs`, `deleteChains`). Filter parameters: `excludeJobChainIds` → `excludeChainIds`, `jobChainId` → `chainId`, `jobChainTypeName` → `chainTypeName`.
  - Adapter lifecycle: `NotifyAdapter` and `StateAdapter` now require an idempotent `close()`. Provider-level `close()` is optional, only on resource-owning providers. `PgPoolNotifyProvider` type removed (`createPgPoolNotifyProvider` returns plain `PgNotifyProvider`).
  - Wake hints: `notifyJobScheduled(typeName)` no longer takes a count. New `provideWakeHint(typeName, count)` and `consumeWakeHint(typeName)` methods, keyed by type name and additive across concurrent publishers.
  - Concurrent reads: `createAsyncLock` / `AsyncLock` → `createAsyncRwLock` / `AsyncRwLock` with `acquireRead()` / `acquireWrite()` returning a `Disposable`-compatible `LockHandle`. `SqliteStateProvider.executeSql` and `PgStateProvider.executeSql` require new `paramTypes` and `readOnly` fields; `params` is no longer optional. Custom SQLite providers must consult `readOnly` to opt into concurrent reads.
  - Lock option replaces FOR UPDATE getters: `getJobForUpdate` and `getLatestChainJobForUpdate` removed. Pass `lock: "exclusive"` to `getJob` / `getChain`. `getChain({ lock: "exclusive" })` now locks only the latest job in the chain.
  - Transaction-hook flush: cross-hook ordering is no longer guaranteed. Custom hooks needing ordering must register under a single key.
  - Cached prepared statements: custom providers see an optional `id?: string` on `executeSql`. Behind transaction-mode poolers (PgBouncer, Supavisor), write a custom provider that ignores `id`.
  - `RescheduleJobError` no longer carries `cause: undefined` when not supplied. `BaseTxContext` exported only from `queuert` (the duplicate from `queuert/internal` is removed).

  **Fixes:**
  - `@queuert/postgres`: `addJobsBlockersSql` now `FOR UPDATE`s the latest job of each blocker chain before inserting blockers, closing a race that could leave a blocked job stuck.

### Patch Changes

- Updated dependencies
  - queuert@0.12.0

## 0.11.0

### Minor Changes

- Promote in-process adapters to the public `queuert` entry (now async), add `queuert/conformance` runner for building and certifying custom adapters, and introduce singular `deleteJobChain` + plural `triggerJobs` client APIs. Add Redis Cluster support (new cluster notify examples), and optional `withSavepoint` hooks on `PgStateProvider` / `SqliteStateProvider` for drivers with native savepoint tracking. New guides and examples for prioritization and error recovery.

  **Breaking:**
  - `runInTransaction` → `withTransaction` (StateAdapter, Pg/Sqlite providers).
  - `HookDef` → `HookDefinition`.
  - `createPgNotifyAdapter` / `createRedisNotifyAdapter`: option `provider` → `notifyProvider`.
  - `createInProcessStateAdapter` / `createInProcessNotifyAdapter` are now async (and moved from `queuert/internal` to `queuert`).
  - `client.deleteJobChain` returns `undefined` for missing chains instead of throwing `JobChainNotFoundError`.
  - `StateAdapter`: `triggerJob` replaced by `triggerJobs`; `deleteJobChains` returns `{ deleted, blockerRefs }`; adapters now enforce blocker validation.
  - Custom `PgStateProvider` / `SqliteStateProvider`: `executeSql` takes `paramTypes` / `columnTypes` (replacing the `returns` flag).
  - `pgLiteral` / `sqliteLiteral` removed from public package entries.
  - `Job<…>` gained a `TOutput` generic parameter.

### Patch Changes

- Updated dependencies
  - queuert@0.11.0

## 0.10.0

### Minor Changes

- - Add `vacuum()` method to Postgres state adapter for on-demand dead-tuple reclamation on job tables. New `vacuum_tuning` migration configures fillfactor and aggressive autovacuum settings to reduce table bloat automatically
  - Add `vacuum()` method to SQLite state adapter for on-demand page reclamation via incremental vacuum. `migrateToLatest()` now validates that `auto_vacuum = INCREMENTAL` is set on the database
  - Fix NATS notification buffering: flush the connection after each publish to ensure timely delivery
  - Relax `@opentelemetry/api` peer dependency from `^1.9.0` to `^0.14.0`

### Patch Changes

- Updated dependencies
  - queuert@0.10.0

## 0.9.5

### Patch Changes

- - Add `excludeJobChainIds` option to deduplication, allowing callers to skip specific chains during deduplication matching
  - Improve Client type covariance: `Client<A | B>` is now assignable to `Client<A>`
  - Add compile-time validation that `createJobTypeProcessorRegistry` receives a client with all required job types
  - Export `BaseTxContext`, `HookDef`, and `TransactionHooksSavepoint` from the public API
  - Add cascade delete option for job chains in the dashboard UI and API
  - BREAKING: `createDashboard` is now async and must be awaited
- Updated dependencies
  - queuert@0.9.5

## 0.9.4

### Patch Changes

- Mutating client methods (`startJobChain`, `startJobChains`, `deleteJobChains`, `triggerJob`, `completeJobChain`) now enforce that a transaction context from `runInTransaction` is provided at runtime, throwing `TransactionContextRequiredError` if omitted. This matches the existing TypeScript type requirements and ensures consistent behavior for JavaScript callers.
- Updated dependencies
  - queuert@0.9.4

## 0.9.3

### Patch Changes

- Simplified `JobAttemptMiddleware` type signature — the second type parameter (`TJobTypeDefinitions`) has been removed from `JobAttemptMiddleware` and `JobTypeProcessorDefaults`. Middleware definitions are now simpler: use `JobAttemptMiddleware<typeof stateAdapter>` instead of `JobAttemptMiddleware<typeof stateAdapter, JobTypeRegistryDefinitions<typeof registry>>`. Additionally, `ResolvedJobChain` now correctly excludes `undefined` from the output type of intermediate chain steps.
- Updated dependencies
  - queuert@0.9.3

## 0.9.2

### Patch Changes

- Fix broken package exports in published npm packages
- Updated dependencies
  - queuert@0.9.2

## 0.9.1

### Patch Changes

- Fix broken package exports in published npm packages
- Updated dependencies
  - queuert@0.9.1

## 0.9.0

### Minor Changes

- ### Features
  - Error messages stored for failed jobs now include the full stack trace and custom Error properties instead of just `[object Object]` or a bare message string.
  - New observability events `jobChainDeleted` and `jobTriggered` are emitted through logging, OTel, and custom observability adapters.
  - `triggerJob` now guards against non-pending jobs and uses row-level locking to prevent race conditions.

  ### Breaking changes
  - The Postgres adapter default schema is now `"public"` with table prefix `"queuert_"` (previously `"queuert"` schema with no prefix). Pass `{ schema: "queuert", tablePrefix: "" }` to `createPgStateAdapter` to preserve existing behavior.
  - Several internal type exports have been removed: `NavigationMap`, `BaseNavigationMap`, `BaseNavigationEntry`, `JobTypeRegistryNavigation`, `ChainJobTypeNames`, `ContinuationJobTypes`, `EntryJobTypeDefinitions`, `BlockedJobTypeNames`, `ChainTypesReaching`, `JobTypeProcessorRegistryNavigation`, `processorNavigationSymbol`. Use `JobTypeNames`, `JobTypeEntryNames`, and `JobTypeProperty` as replacements where applicable.
  - Merged registry definitions are now a union type instead of an intersection.

### Patch Changes

- Updated dependencies
  - queuert@0.9.0

## 0.8.1

### Patch Changes

- ### Dashboard
  - Fixed job detail continuation lookup to use a targeted query instead of fetching the entire chain, significantly improving performance for long chains.
  - Fixed a race condition where changing filters while a "load more" request was in-flight could append stale results in the chain and job list views.
  - The `leasedBy` badge in the job list now only appears for running jobs.
  - Fixed TypeScript type inference for `createDashboard` — the `client` option now preserves generic types instead of requiring `Client<any, any>`.

- Updated dependencies
  - queuert@0.8.1

## 0.8.0

### Minor Changes

- **Breaking changes:**
  - Renamed worker and client options for clarity: `registry` is now `jobTypeRegistry`, `processorRegistry` is now `jobTypeProcessorRegistry`, `processDefaults` is now `jobTypeProcessorDefaults`. The `InProcessWorkerProcessDefaults` type is now `JobTypeProcessorDefaults`. `mergeJobTypeRegistries` and `mergeJobTypeProcessorRegistries` now take `{ slices: [...] }`.
  - The `Job` type now has a 5th type parameter `TOutput`. Completed jobs expose an `output` field.
  - Dashboard now takes a `Client` instance instead of raw adapters.

  **New features:**
  - `triggerJob` client method: trigger a pending job immediately, bypassing its scheduled time.
  - `listJobs` now supports a `jobChainTypeName` filter to query jobs by their chain's type.
  - `createJobTypeProcessorRegistry` rejects merged registries at runtime with a clear error message.

  **Bug fixes:**
  - `continueWith` now uses distributive conditional types for correct type checking across union job types.
  - `completeJobChain` rejects un-narrowed union jobs, preventing ambiguous completions.

  **Dashboard:**
  - Chain deletion with confirmation dialog.
  - "Trigger" button for pending jobs.
  - Dashboard now uses the Client API internally with seroval serialization, preserving Date objects in the UI.

### Patch Changes

- Updated dependencies
  - queuert@0.8.0

## 0.7.0

### Minor Changes

- - Add savepoint support to `TransactionHooks` for automatic rollback of buffered side effects. New methods: `withSavepoint(fn)` and `createSavepoint()`. Hook definitions can now provide a `checkpoint` callback.
  - Fix: lease renewal now only runs in staged mode, avoiding unnecessary work in atomic/deferred modes.
  - Fix: error handler properly rolls back transactions on inner failure, preventing inconsistent job state.
  - Fix: default `TJobId` type corrected from `string` to `UUID` on built-in adapters.
  - `StateAdapter.withSavepoint` is now required with simplified positional signature.
  - `HookDef` and `TransactionHooksSavepoint` types are now exported.

### Patch Changes

- Updated dependencies
  - queuert@0.7.0

## 0.6.0

### Minor Changes

- **New: Batch `startJobChains` API** — Create multiple job chains in a single operation with type-safe returns and optimized DB round-trips.

  **New: Savepoint-protected user callbacks** — `prepare` and `complete` callbacks run inside savepoints on PostgreSQL, preventing transaction poisoning. Custom adapters can opt in via `withSavepoint`.

  **Breaking: StateAdapter interface updated** — `createJob`/`addJobBlockers` replaced by batched `createJobs`/`addJobsBlockers`.

  **Breaking: Removed type exports** — `CompleteJobChainResult` and `JobChainCompleteOptions` are now internal.

### Patch Changes

- Updated dependencies
  - queuert@0.6.0

## 0.5.1

### Patch Changes

- Add compile-time validation for job type definitions and processor registries. Validation adapters now surface definition errors (missing output schemas, invalid blocker references, unknown type names) as TypeScript errors instead of accepting them silently. `createInProcessWorker` rejects processor registries containing job types unknown to the client at compile time. New exported types: `ValidatedJobTypeDefinitions`, `JobTypeDefinitionErrors`.
- Updated dependencies
  - queuert@0.5.1

## 0.5.0

### Minor Changes

- **Renamed core APIs for consistency**: `defineJobTypes` is now `defineJobTypeRegistry`, processor registries use `createJobTypeProcessorRegistry`, and `createInProcessWorker` accepts `processorRegistry`. `mergeJobTypeProcessors` is now `mergeJobTypeProcessorRegistries`.

  **`continueWith` restricted to local types**: `continueWith` targets now validate against local job type definitions only. Blockers remain validated against the full set (local + external).

  **Faster type checking**: Navigation types rewritten in tail-recursive form with precomputed maps, reducing type instantiations by up to 86% in blocker-heavy scenarios.

### Patch Changes

- Updated dependencies
  - queuert@0.5.0

## 0.4.0

### Minor Changes

- Add feature slices with `mergeJobTypeRegistries` and `mergeJobTypeProcessors`

  Split job type definitions and processors into independent feature modules (slices), then merge them at the application level. Duplicate job types are detected at both compile time and runtime.

  `defineJobTypes` now accepts an optional `TExternal` type parameter for compile-time validation of cross-slice blocker and continueWith references.

  Other changes:
  - Trace context types narrowed from `unknown` to `string | null` across `ObservabilityAdapter`, `StateAdapter`, and all storage backends. Postgres trace columns changed from `jsonb` to `text` (migration required).
  - Navigation utility types renamed for clarity: `JobOf` -> `ResolvedJob`, `JobChainOf` -> `ResolvedJobChain`, `ChainJobTypes` -> `ChainJobTypeNames`, and others.
  - Handler/callback types renamed: `AttemptHandlerFn` -> `AttemptHandler`, `PrepareFn` -> `AttemptPrepare`, `CompleteFn` -> `AttemptComplete`, `CompleteCallbackOptions` -> `AttemptCompleteOptions`, `PrepareConfig` -> `AttemptPrepareOptions`.
  - Registry phantom property replaced with symbol; use `JobTypeRegistryDefinitions<T>` utility type. `PartialJobTypeReference` replaced by `JobTypeReference` union.
  - `JobTypeRegistryConfig` now requires `getTypeNames` callback.

### Patch Changes

- Updated dependencies
  - queuert@0.4.0

## 0.3.2

### Patch Changes

- Replace the per-request CSP `nonce` option with a new `basePath` option on `createDashboard()`. Set `basePath` to your mount prefix when serving the dashboard at a sub-path. The `fetch` handler no longer accepts a second argument. The frontend now derives its base URL from the `<base>` tag, making sub-path routing and asset loading reliable across reverse-proxy setups.
- Updated dependencies
  - queuert@0.3.2

## 0.3.1

### Patch Changes

- Fix dashboard sub-path asset loading and CSP nonce support. Update documentation with API reference section.
- Updated dependencies
  - queuert@0.3.1

## 0.3.0

### Minor Changes

- ### Breaking Changes
  - Redesigned worker to use parallel slot-based execution model
  - Simplified API naming by removing redundant `Queuert` prefix (`createClient`, `createInProcessWorker`)
  - Simplified worker config API by reducing property verbosity
  - Renamed deduplication API from strategy to scope
  - Replaced `withNotify` with `CommitHooks` for explicit side-effect buffering
  - Renamed `CommitHooks` to `TransactionHooks` and added discard support
  - Accept client instance in `createInProcessWorker` instead of individual adapters
  - Replaced `startBlockers` callback with `blockers` array
  - Removed `originId` from job model, use deduplication key for continuations
  - Removed `rootChainId` from job model, unified chain deletion
  - Removed `updatedAt` from `StateJob` and database schema
  - Removed state adapter retry wrapper
  - Split trace context into separate chain and job fields
  - Moved blockers from `Job` base type to separate `JobWithBlockers` wrapper
  - Renamed `waitForJobChainCompletion` to `awaitJobChain`
  - Renamed state adapter methods for clarity and consistency
  - Improved error classes and client API consistency
  - Added `chain_index` for deterministic chain ordering and continuation dedup
  - Changed `deleteJobChains` to return deleted chains
  - Added distributed tracing to `ObservabilityAdapter`
  - Hardcoded `queuert` metric prefix and removed messaging semantic convention attributes in OTEL adapter
  - Cleaned up type exports and renamed reference types

  ### New Features
  - **Dashboard**: New `@queuert/dashboard` package with job and chain listing UI
  - **Client query API**: Pagination and type narrowing for `queryJobs` and `queryJobChains`
  - **Distributed tracing**: OTEL blocker spans with trace context persistence across job chains
  - **Cascade deletion**: `cascade` option on `deleteJobChains` for transitive dependency deletion
  - **`awaitJobChain`**: Await chain completion with configurable polling
  - **Table prefix**: PostgreSQL adapter `tablePrefix` configuration option
  - **Migration tracking**: Migration version tracking for PostgreSQL and SQLite adapters
  - **Transaction hooks**: `createTransactionHooks` for manual flush/discard lifecycle
  - **Documentation site**: Astro-based docs with TSDoc API reference generation

  ### Improvements
  - Parallel slot-based worker execution for better throughput
  - Workers only subscribe to job notifications when idle slots are available
  - Buffered observability events via transaction hooks
  - State and notify adapter conformance test suites for adapter authors
  - Comprehensive examples: query, chain-awaiting, chain-deletion, blockers, error-handling, timeouts, workerless, scheduling, deduplication, processing modes, NATS, multi-worker, ArkType validation, memory footprint benchmark
  - Shared TypeScript configuration via `@queuert/tsconfig` package
  - Redesigned dashboard to use standard Web APIs instead of Hono

  ### Bug Fixes
  - Fixed workers reaping their own in-progress jobs with concurrent slots
  - Scoped deduplication key by chain type name
  - Fixed context leakage to independent chains during job processing
  - Fixed orphaned timers blocking process exit
  - Removed notification listeners before releasing PostgreSQL pool client
  - Only subscribe to job notifications when worker has idle slots
  - Added NOT NULL constraint to `chain_id` column in PostgreSQL and SQLite schemas

### Patch Changes

- Updated dependencies
  - queuert@0.3.0

## 0.2.0

### Minor Changes

- ### Breaking Changes
  - Split `createQueuert` into `createQueuertClient` and `createQueuertInProcessWorker` for clearer separation of concerns
  - Simplified adapter API by removing `provideContext` and making `txContext` optional
  - Changed Log API from tuple args to named `data`/`error` properties
  - Renamed `JobSequence` to `JobChain` across the entire API
  - Simplified `migrateToLatest` API and removed nested transaction support

  ### New Features
  - **ObservabilityAdapter**: OpenTelemetry integration with histogram metrics for duration tracking and gauge metrics for worker state
  - **JobTypeRegistry**: Compile-time and runtime validation with support for Zod, Valibot, and TypeBox
  - **NATS adapter**: New `@queuert/nats` notify adapter with optional JetStream KV
  - **Job attempt middlewares**: Support for contextual logging during job processing
  - **Deferred scheduling**: Schedule jobs for future execution via `schedule` option
  - **Thundering herd optimization**: Hint-based notification system reduces unnecessary polling

  ### Improvements
  - Single-statement migrations for cleaner provider implementations
  - Restructured documentation into modular design docs
  - Reorganized examples to single-purpose design with clear naming conventions
  - Relaxed peer dependency version constraints

  ### Bug Fixes
  - Prevent context leakage to independent chains during job processing
  - Fix orphaned timers blocking process exit
  - Correct type extraction for dual-context adapters

### Patch Changes

- Updated dependencies
  - queuert@0.2.0

## 0.1.2

### Patch Changes

- Add comprehensive README documentation
- Updated dependencies
  - queuert@0.1.2

## 0.1.1

### Patch Changes

- Add OIDC trusted publishing support for npm
- Updated dependencies
  - queuert@0.1.1

## 0.1.0

### Minor Changes

- Initial release
