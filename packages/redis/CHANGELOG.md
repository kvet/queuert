# @queuert/redis

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
