# queuert

## 0.16.0

### Major Changes

- 09f353d: Remove internal helper types from the `queuert` package exports. These types described implementation details rather than the API you call, and keeping them exported locked their shapes in place. Nothing changes at runtime; if you imported one of them, derive it from the public API (e.g. `Parameters<typeof createJobTypes>[0]`) or inline the shape.

  - `JobTypesOptions` is removed; `createJobTypes` takes the same options object inline.
  - `JobTypeDefs`, `NominalJobTypeReference`, `StructuralJobTypeReference` and `ResolvedJobTypeReference` are no longer exported.
  - `ResolvedChain`, `ResolvedChainJobs`, `ResolvedJob`, `BlockerChains` and `JobTypeProperty` are no longer exported.
  - `AttemptHandler`, `AttemptPrepare`, `AttemptPrepareCallback`, `AttemptPrepareOptions`, `AttemptComplete`, `AttemptCompleteCallback` and `AttemptCompleteOptions` are no longer exported.
  - `ProcessorDefinitions` and `InProcessWorkerProcessor` are no longer exported.

- 24ff428: Rework the attempt's `complete` phase into a callback that decides the outcome via `finish`. The outcome is a plain object — `{ output }` or `{ continueWith: { typeName, input, ... } }`. `finish` writes before it returns, so code after it observes the committed state within the same transaction.

  - Migrate `complete(async () => output)` → `complete(async ({ finish }) => finish({ output }))`.
  - Migrate `complete(async ({ continueWith }) => continueWith(x))` → `complete(async ({ finish }) => finish({ continueWith: x }))`.
  - `finish({ output })` returns the completed job; `finish({ continueWith })` returns the completed job with the new job on `continuedTo`.
  - `client.completeChain`'s `complete` option is renamed `handler`, and the function it receives is renamed `completeJob` to distinguish it from the worker's `complete` (which finishes the current job and takes no job argument). `completeJob(job, callback)` uses the same `finish` vocabulary and unwraps whatever the callback returns: return the `finish({ continueWith })` result and you get the continuation back, so a handler can walk several jobs with `job = await completeJob(job, ...)`; a `finish({ output })` result resolves to the completed job.
  - The `prepare`, `step` and `complete` spans now record the exception and report `ERROR` status when the phase throws, and the `complete` span is no longer left unended when it does.
  - The CONSUMER span emitted when a blocker chain completes is renamed from `resolve chain.{type}` to `complete chain.{type}`; update trace queries and alerts that match `resolve chain.*`.

- a1e6c1a: Fix `AttemptMiddleware` typed with a concrete state adapter (e.g. `AttemptMiddleware<typeof stateAdapter, …>`) silently collapsing the handler context to `unknown` whenever two or more middleware were composed. Middleware can now be typed against your adapter, giving fully typed transaction context (`sql`, `db`, …) inside `wrapPrepare` / `wrapStep` / `wrapComplete` and correct ctx inference in the handler, and tuples may freely mix adapter-typed and `any`-typed middleware. `createProcessors` and `createInProcessWorker` additionally reject middleware typed against a _different_ adapter than the client's, which previously type-checked and then failed at runtime when a hook destructured a transaction context that adapter never provides. Middleware typed with `any` keeps working unchanged.
- 67833e1: Rename `client.startChain` to `client.createChain` and `client.startChains` to `client.createChains`. The old names suggested the call began execution, which was misleading — the methods create a chain transactionally and a worker picks it up later (possibly much later, with `schedule`).

  - `client.startChain(...)` → `client.createChain(...)`
  - `client.startChains(...)` → `client.createChains(...)`

- 24ff428: Remove `excludeChainIds` from `DeduplicationOptions`. It existed for exactly one reason: a recurring chain self-scheduling its next occurrence under `scope: "running"` matched the chain it was completing, because the completion write had not happened yet when the handler ran. The attempt finalization rework removes that ordering — `finish({ output })` and `finish({ continueWith })` write their transition before returning — so a `createChain` placed after the terminal action already sees the chain as completed and cannot match it. Move the scheduling call after `finish(...)` and drop the option; nothing is persisted for it, so no migration is needed. Scheduling the next occurrence from a mid-chain job, or before the terminal action, now matches the still-running chain and suppresses the occurrence — use `scope: "any"` or schedule from the terminal job instead.

  - `deduplication.excludeChainIds` is no longer accepted by `createChain` / `createChains`.
  - `DeduplicationOptions` loses its type parameter — write `DeduplicationOptions`, not `DeduplicationOptions<string>`.
  - The "Excluding Chains" section of the deduplication guide is replaced by "Self-Scheduling Recurring Chains", which documents the complete-then-schedule ordering; the cleanup and scheduling guides and the `showcase-scheduling` / `showcase-cleanup` examples follow the same shape.

- dc5a2b8: Remove `windowMs` from `DeduplicationOptions`. It was throttling wearing deduplication's clothes, and lossy throttling at that: a suppressed call reported `deduplicated: true` against a chain that may have completed long ago with different input, so the caller could not tell "already queued" from "dropped". Deduplication now matches on `key` and `scope` alone. There is no replacement — if you need rate limiting, do the time check on your side before calling `createChain`, or use an `any`-scoped key together with a retention policy that deletes old chains. Nothing is persisted for `windowMs`, so no migration is needed.

  - `deduplication.windowMs` is no longer accepted by `createChain` / `createChains` (a type error; the option is ignored at runtime).
  - The "Time-Windowed Deduplication" section is gone from the deduplication guide, and the `showcase-scheduling` example drops its rate-limiting scenario.

- e7dd362: `TransactionContextRequiredError` is removed. Client methods that need a transaction context now throw a plain `Error` when called without one. The condition it reported is a malformed call, not a runtime state a caller can recover from: it carried no structured data, and every typed error in the library exists so callers can branch on something they could not have known statically. Code that caught this class specifically should match on the message or drop the catch — nothing else changes about when the throw happens.

  - `TransactionContextRequiredError` is no longer exported from `queuert`.
  - The mutating methods (`createChain`, `createChains`, `completeChain`, `deleteChain`, `deleteChains`, `rescheduleJob`, `rescheduleJobs`) throw `Error("This client method requires a transaction context from withTransaction")` instead.

- 7cb4d94: Caller-supplied `id` on `createChain`/`createChains`/`continueWith` is now assignment-only with a hard error on collision. Previously, PostgreSQL and SQLite silently returned the existing row (with `deduplicated: false`), and the in-process adapter silently overwrote it. Now all three adapters reject a duplicate `id` — SQL adapters surface the raw constraint violation, in-process throws before writing. Deduplication is unaffected and stays exclusively with the `deduplication` option.

  - A caller-supplied `id` that collides with an existing job now errors instead of being silently swallowed.
  - Intra-batch duplicate `id` values in a single `createChains` call error (raw database constraint on SQL adapters).
  - Generated id collisions from a misconfigured `generateId` also error — `generateId` must return unique values.
  - `id` remains optional; when omitted, `generateId()` produces the id as before.

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

- 23ed227: Anchor every listing query to a single type so it can use a type-specific index, and add type discovery so callers (and the dashboard) can find which types to list. `listChains` and `listJobs` now require a single `typeName` string instead of accepting an optional array.

  - Add `client.listChainTypeNames()` and `client.listJobTypeNames()`, which return a sorted array of the distinct chain and job type names present in the store.
  - Add `client.countByChainTypeNames()` and `client.countByJobTypeNames()` for per-status counts of the given type names, each capped with a `hasMore` flag.
  - **Breaking:** `listChains` and `listJobs` require `typeName: string`; the `chainId` and `jobId` filters are removed from both, and `chainTypeName` is removed from `listJobs` — use `listChainJobs({ chainId })` to read the jobs of a specific chain and `getJob`/`getJobs` to fetch jobs by id.

- 63e0378: Remove the `cascade` option from `deleteChains` and `deleteChain`. Cascade deletion, which expanded the requested chains to include the blocker chains they transitively depend on, is no longer supported: callers that relied on `cascade: true` must enumerate the chains to delete explicitly. Collect a chain's blocker chains with `getJobBlockers` and pass them in the same `deleteChains` call as the chain that depends on them (or delete the dependent chain first); deleting a chain that is still a blocker for a job outside the deleted set fails with `BlockerReferenceError` and deletes nothing.

  - `deleteChains({ cascade })` and `deleteChain({ cascade })` are no longer accepted.
  - The dashboard's delete dialog loses its cascade checkbox and `DELETE /api/chains/:id` no longer honors `?cascade=true`.

- c2a4fe0: Add `finish({ reschedule })` as a non-error rescheduling outcome for attempt handlers and delete the `rescheduleJob()` helper exported from `queuert` together with `RescheduleJobError`. A requested reschedule no longer travels the error path — it skips `lastAttemptError`, does not emit `jobAttemptFailed`, and the attempt span ends `ok`.

  - `finish({ reschedule: { afterMs } })` or `finish({ reschedule: { at } })` returns the job to pending as a first-class outcome alongside `{ output }` and `{ continueWith }`.
  - The top-level `rescheduleJob()` helper (called inside an attempt handler, where it throws) and `RescheduleJobError` are removed from the public API. Migrate: `rescheduleJob({ afterMs })` → `return complete(async ({ finish }) => finish({ reschedule: { afterMs } }))`.
  - The attempt span no longer sets the `queuert.attempt.result` attribute; read the outcome from the span status instead (`ERROR` for a failed attempt, `OK` for a completed, continued or rescheduled one).
  - The `queuert.job.completed` metric no longer carries `queuert.worker.id`; use `queuert.job.attempt.completed` for per-worker breakdowns.

- 63aa316: `wrapHandler` middleware can now observe attempt failures. The handler middleware chain has been moved inside `runJobAttempt`, wrapping the `attemptHandler` call directly — the same pattern as `wrapPrepare`, `wrapStep`, and `wrapComplete`. A `catch` block around `next()` in `wrapHandler` now fires on handler errors, and `finally` runs before a failed attempt is scheduled for retry (not after). Previously dead `catch` blocks in existing `wrapHandler` middleware will become live.

### Minor Changes

- 0719785: Expose job abort reasons to OTel tracing as an `abort` event on the attempt span. When a job's signal is aborted (e.g. `worker_stopping`, `taken_by_another_worker`, `already_completed`), an event is recorded on the attempt span with `queuert.abort.reason` as an attribute, giving operators the exact timestamp and reason for the interruption.
- a44004b: Add batched `client.getChains()` and `client.getJobs()` methods that fetch multiple chains or jobs in a single round trip. Both return a positional array aligned with the input `ids` — `undefined` for any ID that does not exist. The optional `typeName` parameter narrows the return type and validates all found entries. Introduce `ChainTypeMismatchError` for chain type mismatches (previously `JobTypeMismatchError` was used for both chains and jobs); `JobTypeMismatchError` is now reserved for job-only contexts.
- 314fe95: Reduce the type-checking cost of Queuert's types by roughly 20–40% (fewer instantiations, faster editor feedback and `tsc` runs), and fix the type of a chain's `input`. A chain's `input` was typed as a union of every job input along the chain; it is now the entry job's input, matching the value returned at runtime.

  - `chain.input` is now typed as the entry job type's input; `chain.output` is still the union of outputs reachable along the chain, and chains over several entry types are discriminated by `typeName`.
  - `defineJobTypes` validates plain terminal and continuing definitions through a cheaper path; accepted and rejected definitions are unchanged.
  - Single job and chain variants (completed, continued, rescheduled, running, blocker chains) are now built directly instead of filtered from the full status union, with identical shapes.

- Queuert 0.16 rebuilds the job model around the chain's head row and reworks attempt handling around a single `finish` outcome API, with a one-step schema migration from v0.15.1. It also brings faster listing queries, a redesigned dashboard, and a leaner, more consistent public API. This release contains many breaking changes — review the upgrade notes before migrating.
- 24ff428: Add `step` as a third transaction primitive on the attempt handler alongside `prepare` and `complete`. Each call opens a fresh guarded transaction (attempt ownership verified), runs the user callback with `txCtx` and `transactionHooks`, commits, and flushes hooks. Only valid in staged mode between `prepare` and `complete`. Includes `wrapStep` middleware hook. Enables batched transactional work in long-running staged handlers without holding a single long-lived transaction.
- ca681b1: Propagate the worker's stop signal to in-flight job attempt handlers. When `stop()` is called on a worker, all running jobs now receive `"worker_stopping"` as the abort reason on their `signal`. This lets handlers distinguish a graceful worker shutdown from hard aborts (e.g. `"taken_by_another_worker"`) and wrap up cooperatively — finishing partial work, flushing buffers, or breaking out of long loops — instead of running to completion unaware that the worker is draining.

## 0.15.1

### Patch Changes

- f7194ab: Fix a worker busy-loop and make Postgres job acquisition use the acquisition index. A worker whose slots were all busy kept polling the state adapter as fast as the event loop allowed: with a due job in the backlog the poll reported `0ms`, so the wait returned immediately and the worker re-entered the loop without being able to take work. Saturated workers now wait for a slot to free instead of polling. Separately, the Postgres `acquireJob` and `getNextJobAvailableInMs` queries matched jobs with `type_name IN (...)` and ordered by `scheduled_at`, which Postgres cannot satisfy from the `(type_name, scheduled_at)` acquisition index for more than one job type — it fell back to scanning and sorting the entire pending backlog on every acquisition and every poll. Both queries now look up each job type separately so the index is used, turning a scan of the backlog into one index lookup per job type. Workers polling a large Postgres backlog should see a substantial drop in database load.
  - Saturated in-process workers no longer poll `getNextJobAvailableInMs`; they wake when a slot frees or after `pollIntervalMs`
  - Postgres `acquireJob` / `getNextJobAvailableInMs` rewritten as per-job-type `LATERAL` lookups
  - On Postgres, when several job types are polled together, acquisition now picks a job type at random and takes its oldest due job, rather than always taking the globally oldest job; this keeps a backlogged job type from starving the others
  - Postgres `getNextJobAvailableInMs` no longer takes row locks on jobs scheduled in the future

## 0.15.0

### Major Changes

- 02b2167: Rename the client `triggerJob` / `triggerJobs` methods to `rescheduleJob` / `rescheduleJobs`, add an optional `schedule` param, introduce strict batch errors, and make breaking provider changes. No DB migration.
  - `client.triggerJob` → `client.rescheduleJob` and `client.triggerJobs` → `client.rescheduleJobs`. Both now accept an optional `schedule: { at: Date } | { afterMs: number }`; omitting it reschedules to now (the previous behavior) and a past time clamps to now, matching `startChain`. Only `pending` jobs are reschedulable, and batch validation stays atomic.
  - The error classes `JobNotTriggerableError` / `JobsNotTriggerableError` are renamed to `JobNotReschedulableError` / `JobsNotReschedulableError`. New batch error variants `JobsNotFoundError` and `JobsNotReschedulableError` are thrown by `client.rescheduleJobs` when one or more inputs are missing or not pending. The `status` property has been removed from `JobNotReschedulableError`; the batch variant exposes offending ids via `jobIds`.
  - The observability event `jobTriggered` is renamed to `jobRescheduled`; the OpenTelemetry counter `queuert.job.triggered` becomes `queuert.job.rescheduled` and the structured log entry `job_triggered` becomes `job_rescheduled`.
  - `jobRescheduled` is now also emitted by the worker retry path (after a failed attempt is rescheduled), not just by client reschedules, making it the single signal for "a job's `scheduledAt` changed." It carries the resolved `scheduledAt` — the value actually stored. Correspondingly, `jobAttemptFailed` is now a pure failure event — the previous `rescheduledAt` / `rescheduledAfterMs` fields are removed from it (and from the `job_attempt_failed` log entry); observability-adapter authors should read `scheduledAt` from `jobRescheduled` instead.
  - Both `jobCreated` and `jobRescheduled` now report the resolved `scheduledAt` (the absolute value stored after clamping a past time to now) and nothing else schedule-related. The redundant `scheduleAfterMs` field is dropped from both events and their log entries.
  - `StateProvider` (both `@queuert/postgres` and `@queuert/sqlite`) gains a required `transactionConcurrency: "concurrent" | "serialized"` field that reports whether two `withTransaction` callbacks can run in flight at once. Custom providers must declare it — use `"concurrent"` for connection-pool backed providers (pg, postgres-js, Drizzle, Kysely, Prisma over pg) and `"serialized"` for single-handle SQLite drivers.

### Minor Changes

- f5b7f9d: A job can now declare at most 100 blocker chains. `startChain`, `startChains`, and `continueWith` throw the new `BlockerLimitExceededError` (carrying `typeName`, `count`, and `limit`) when a job exceeds the limit, validated up front before any state is written. The cap is intentional — the blocker model is built for bounded fan-in, not millions of dependencies per job — and applies uniformly across every state adapter.

### Patch Changes

- af22109: Fixed `createProcessors` resolving job type names from the local slice only instead of all registered slices, which caused type errors when processors referenced types defined in a different `defineJobTypes` call.
- 082650f: Fixed `"incomplete"` deduplication scope to correctly match multi-step chains that have continued past the root job. Previously, the lookup checked the root job's status directly — once the root completed (to continue to step 2), the chain was no longer matched, even though it was still running. The fix checks whether the chain's last job is completed instead.

## 0.14.1

### Patch Changes

- ee13b9a: Conformance fixture cleanup. `StateConformanceFixture` now propagates `generateId` and `generateInvalidId` through to the cases — previously the runner only forwarded `stateAdapter` and `poisonTransaction`, so adapters configured with a custom `validateId` could not exercise the caller-supplied `id` path. As part of the fix, the separate `StateAdapterConformanceContext` and `NotifyAdapterConformanceContext` types were collapsed into `StateConformanceFixture` / `NotifyConformanceFixture` so a future field addition cannot be silently dropped at the fixture↔context bridge.
  - Added `generateId?: () => string` and `generateInvalidId?: () => string` to `StateConformanceFixture`; `runStateAdapterConformance` now forwards them.
  - Removed `StateAdapterConformanceContext` and `NotifyAdapterConformanceContext`. Callers that referenced these types (e.g. `it.extend<NotifyAdapterConformanceContext>(...)` in vitest specs) should switch to `StateConformanceFixture` / `NotifyConformanceFixture`.

## 0.14.0

### Minor Changes

- 66a3c9c: Allow callers to assign job IDs and validate them adapter-side. `startChain`, `startChains`, and the worker `continueWith` callback now accept an optional `id` that becomes the new chain root (or continuation) job ID. State adapters accept a new `validateId` predicate that runs on both adapter-generated and caller-supplied IDs; failures throw the new `InvalidJobIdError`. When deduplication fires, the existing row's ID wins over a caller-supplied `id` (the returned chain carries `deduplicated: true`).

  Adapter ID-generation options are now aligned: both PostgreSQL and SQLite adapters expose a `generateId` function (renamed from `idGenerator` on SQLite; replacing the SQL `idDefault` option on PostgreSQL). The PostgreSQL adapter switches from server-side default expressions to JS-side ID generation, and a new migration drops `DEFAULT gen_random_uuid()` from the `id` column. Existing UUID generation behavior is unchanged for default configurations.
  - PostgreSQL: replace `idDefault: "gen_random_uuid()"` with `generateId: () => crypto.randomUUID()` (this is the default and can be omitted).
  - PostgreSQL: replace `idDefault: "'job.' || gen_random_uuid()::text"` with `generateId: () => \`job.${crypto.randomUUID()}\``.
  - SQLite: rename `idGenerator` option to `generateId`.
  - Custom state adapter implementations must accept an optional `id` per entry in `createJobs` and apply their own `validateId` predicate.

- 0fd8d55: `scheduled_at` is now the honest "earliest moment eligible" floor: state adapters clamp it to `MAX(requested, now())` on `createJobs`, `rescheduleJob`, and `unblockJobs`. Previously, jobs with a user-supplied past `scheduled_at` (or blocked-since-creation jobs whose original `scheduled_at` went stale while they waited) would jump to the front of the acquisition queue ahead of jobs that genuinely became ready earlier. Behavior change for `unblockJobs`: it previously reset `scheduled_at` to `now()` unconditionally; it now preserves a future `scheduled_at` set at job creation (the clamp picks the later of the two), so an intended future delay survives a blocker round-trip. `triggerJobs` continues to reset to `now()` as an explicit re-anchor. Applies to the PostgreSQL, SQLite, and in-process adapters; no schema migration or backfill required.

### Patch Changes

- 956bbd3: Clear `lastAttemptError` when a job completes successfully. Previously, if a job failed an attempt and then succeeded on a retry, the completed row retained the error string from the prior failed attempt, making completed jobs appear to have errored. `completeJob` now resets `last_attempt_error` to `NULL` in the PostgreSQL, SQLite, and in-process adapters alongside the existing status/output/lease updates.
- 3da743c: Fix a spurious type error from `createInProcessWorker`'s `requiredAttemptMiddleware` check when the middleware was typed against a user-supplied `StateAdapter` alias (e.g. `AttemptMiddleware<MyStateAdapter>`). Valid processor slices were being flagged as missing required middleware. Runtime behavior was unaffected; this is a type-only fix.
- 673d669: Tighten `BaseTxContext` from `{}` to `Record<string, unknown>`. The previous `{}` constraint accepted any non-nullish value (string, number, function), letting custom `StateAdapter` authors pick a non-object `TTxContext` without a type error. All built-in adapters are already object-shaped, so no runtime behavior changes.

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

## 0.10.0

### Minor Changes

- - Add `vacuum()` method to Postgres state adapter for on-demand dead-tuple reclamation on job tables. New `vacuum_tuning` migration configures fillfactor and aggressive autovacuum settings to reduce table bloat automatically
  - Add `vacuum()` method to SQLite state adapter for on-demand page reclamation via incremental vacuum. `migrateToLatest()` now validates that `auto_vacuum = INCREMENTAL` is set on the database
  - Fix NATS notification buffering: flush the connection after each publish to ensure timely delivery
  - Relax `@opentelemetry/api` peer dependency from `^1.9.0` to `^0.14.0`

## 0.9.5

### Patch Changes

- - Add `excludeJobChainIds` option to deduplication, allowing callers to skip specific chains during deduplication matching
  - Improve Client type covariance: `Client<A | B>` is now assignable to `Client<A>`
  - Add compile-time validation that `createJobTypeProcessorRegistry` receives a client with all required job types
  - Export `BaseTxContext`, `HookDef`, and `TransactionHooksSavepoint` from the public API
  - Add cascade delete option for job chains in the dashboard UI and API
  - BREAKING: `createDashboard` is now async and must be awaited

## 0.9.4

### Patch Changes

- Mutating client methods (`startJobChain`, `startJobChains`, `deleteJobChains`, `triggerJob`, `completeJobChain`) now enforce that a transaction context from `runInTransaction` is provided at runtime, throwing `TransactionContextRequiredError` if omitted. This matches the existing TypeScript type requirements and ensures consistent behavior for JavaScript callers.

## 0.9.3

### Patch Changes

- Simplified `JobAttemptMiddleware` type signature — the second type parameter (`TJobTypeDefinitions`) has been removed from `JobAttemptMiddleware` and `JobTypeProcessorDefaults`. Middleware definitions are now simpler: use `JobAttemptMiddleware<typeof stateAdapter>` instead of `JobAttemptMiddleware<typeof stateAdapter, JobTypeRegistryDefinitions<typeof registry>>`. Additionally, `ResolvedJobChain` now correctly excludes `undefined` from the output type of intermediate chain steps.

## 0.9.2

### Patch Changes

- Fix broken package exports in published npm packages

## 0.9.1

### Patch Changes

- Fix broken package exports in published npm packages

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

## 0.8.1

### Patch Changes

- ### Dashboard
  - Fixed job detail continuation lookup to use a targeted query instead of fetching the entire chain, significantly improving performance for long chains.
  - Fixed a race condition where changing filters while a "load more" request was in-flight could append stale results in the chain and job list views.
  - The `leasedBy` badge in the job list now only appears for running jobs.
  - Fixed TypeScript type inference for `createDashboard` — the `client` option now preserves generic types instead of requiring `Client<any, any>`.

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

## 0.7.0

### Minor Changes

- - Add savepoint support to `TransactionHooks` for automatic rollback of buffered side effects. New methods: `withSavepoint(fn)` and `createSavepoint()`. Hook definitions can now provide a `checkpoint` callback.
  - Fix: lease renewal now only runs in staged mode, avoiding unnecessary work in atomic/deferred modes.
  - Fix: error handler properly rolls back transactions on inner failure, preventing inconsistent job state.
  - Fix: default `TJobId` type corrected from `string` to `UUID` on built-in adapters.
  - `StateAdapter.withSavepoint` is now required with simplified positional signature.
  - `HookDef` and `TransactionHooksSavepoint` types are now exported.

## 0.6.0

### Minor Changes

- **New: Batch `startJobChains` API** — Create multiple job chains in a single operation with type-safe returns and optimized DB round-trips.

  **New: Savepoint-protected user callbacks** — `prepare` and `complete` callbacks run inside savepoints on PostgreSQL, preventing transaction poisoning. Custom adapters can opt in via `withSavepoint`.

  **Breaking: StateAdapter interface updated** — `createJob`/`addJobBlockers` replaced by batched `createJobs`/`addJobsBlockers`.

  **Breaking: Removed type exports** — `CompleteJobChainResult` and `JobChainCompleteOptions` are now internal.

## 0.5.1

### Patch Changes

- Add compile-time validation for job type definitions and processor registries. Validation adapters now surface definition errors (missing output schemas, invalid blocker references, unknown type names) as TypeScript errors instead of accepting them silently. `createInProcessWorker` rejects processor registries containing job types unknown to the client at compile time. New exported types: `ValidatedJobTypeDefinitions`, `JobTypeDefinitionErrors`.

## 0.5.0

### Minor Changes

- **Renamed core APIs for consistency**: `defineJobTypes` is now `defineJobTypeRegistry`, processor registries use `createJobTypeProcessorRegistry`, and `createInProcessWorker` accepts `processorRegistry`. `mergeJobTypeProcessors` is now `mergeJobTypeProcessorRegistries`.

  **`continueWith` restricted to local types**: `continueWith` targets now validate against local job type definitions only. Blockers remain validated against the full set (local + external).

  **Faster type checking**: Navigation types rewritten in tail-recursive form with precomputed maps, reducing type instantiations by up to 86% in blocker-heavy scenarios.

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

## 0.3.2

### Patch Changes

- Replace the per-request CSP `nonce` option with a new `basePath` option on `createDashboard()`. Set `basePath` to your mount prefix when serving the dashboard at a sub-path. The `fetch` handler no longer accepts a second argument. The frontend now derives its base URL from the `<base>` tag, making sub-path routing and asset loading reliable across reverse-proxy setups.

## 0.3.1

### Patch Changes

- Fix dashboard sub-path asset loading and CSP nonce support. Update documentation with API reference section.

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

## 0.1.2

### Patch Changes

- Add comprehensive README documentation

## 0.1.1

### Patch Changes

- Add OIDC trusted publishing support for npm

## 0.1.0

### Minor Changes

- Initial release
