# Queuert Code Style Guide

## License

MIT License - see [LICENSE](LICENSE) for details.

## Project Structure

Queuert is a monorepo with the following packages:

### `queuert`

Core abstractions, interfaces, and in-memory implementations for testing.

**Exports:**

- `.` (main): `createQueuert`, `createConsoleLog`, adapter interfaces (`StateAdapter`, `NotifyAdapter`, `ObservabilityAdapter`), type definitions, error classes, in-process adapters (`createInProcessStateAdapter`, `createInProcessNotifyAdapter`)
- `./testing`: Test suites and context helpers for adapter packages (`processTestSuite`, `sequencesTestSuite`, etc., `extendWithCommon`, `extendWithStateInProcess`)
- `./internal`: Internal utilities for adapter packages only (`withRetry`, `createAsyncLock`, `wrapStateAdapterWithRetry`)

### `@queuert/postgres`

PostgreSQL state adapter and notify adapter implementations. Users provide their own `pg` client.

**Exports:**

- `.` (main): `createPgStateAdapter`, `PgStateAdapter` type, `createPgNotifyAdapter`, `PgNotifyProvider` type
- `./testing`: Test helpers for PostgreSQL tests (`extendWithStatePostgres`, `extendWithPostgresNotify`, `createPgPoolNotifyProvider`)

**Dependencies:**

- `queuert` as peer dependency

**Notify adapter notes:**

The PostgreSQL notify adapter uses LISTEN/NOTIFY for pub/sub. Does not implement hint-based thundering herd optimization - all listeners query the database when a job is scheduled. Uses 3 fixed channels with payload-based filtering. LISTEN/NOTIFY is fire-and-forget; the existing polling fallback in workers ensures reliability.

### `@queuert/sqlite`

SQLite state adapter implementation using better-sqlite3.

**Exports:**

- `.` (main): `createSqliteStateAdapter`, `SqliteStateAdapter` type, `createAsyncLock` (re-exported from `queuert/internal`)
- `./testing`: Test helper for SQLite tests (`extendWithStateSqlite`)

**Dependencies:**

- `queuert` as peer dependency

### `@queuert/mongodb`

MongoDB state adapter implementation. Users provide their own MongoDB client.

**Exports:**

- `.` (main): `createMongoStateAdapter`, `MongoStateAdapter` type
- `./testing`: Test helper for MongoDB tests (`extendWithStateMongodb`)

**Dependencies:**

- `queuert` as peer dependency
- `mongodb` as peer dependency (requires 6.0+)

**Adapter notes:**

- Requires MongoDB 4.0+ for multi-document ACID transactions
- Uses a single `jobs` collection with embedded blockers array (no separate blocker table)
- Job IDs generated application-side using `crypto.randomUUID()` by default (configurable via `idGenerator`)
- Uses atomic `findOneAndUpdate` for job acquisition (similar behavior to PostgreSQL's `FOR UPDATE SKIP LOCKED`)
- Transactions use manual `startTransaction`/`commitTransaction`/`abortTransaction` for explicit error handling
- Transient error detection includes MongoDB network errors, timeout errors, and common Node.js connection errors (ECONNRESET, ETIMEDOUT, etc.)

**Configuration options:**

- `stateProvider`: MongoDB state provider implementation
- `idGenerator`: Function returning job ID strings (default: `() => crypto.randomUUID()`)
- `connectionRetryConfig`: Retry configuration for transient connection errors
- `isTransientError`: Custom function to identify transient errors

### `@queuert/redis`

Redis notify adapter implementation for distributed pub/sub notifications.

**Exports:**

- `.` (main): `createRedisNotifyAdapter`
- `./testing`: Test helper for Redis tests (`extendWithNotifyRedis`)

**Dependencies:**

- `queuert` as peer dependency

**Notify adapter notes:**

Uses 3 fixed channels with payload-based filtering (same pattern as PostgreSQL). Implements hint-based thundering herd optimization using Lua scripts for atomic decrement operations. Requires two Redis connections: one for commands (PUBLISH, EVAL) and one for subscriptions (SUBSCRIBE).

### `@queuert/nats`

NATS notify adapter implementation for distributed pub/sub notifications with optional JetStream KV support.

**Exports:**

- `.` (main): `createNatsNotifyAdapter`
- `./testing`: Test helper for NATS tests (`extendWithNatsNotify`)

**Dependencies:**

- `queuert` as peer dependency
- `nats` as peer dependency (requires ^2.28.0)

**Notify adapter notes:**

Uses 3 NATS subjects with payload-based filtering (`{prefix}.sched`, `{prefix}.seqc`, `{prefix}.owls`). Supports optional JetStream KV for hint-based thundering herd optimization using revision-based CAS operations. Without JetStream KV, behaves like PostgreSQL (all listeners query database). Unlike Redis, NATS is fully multiplexed and a single connection handles both publishing and subscriptions.

**Configuration options:**

- `nc`: NATS connection
- `kv`: Optional JetStream KV bucket for hint optimization
- `subjectPrefix`: Subject prefix (default: `"queuert"`)

### `@queuert/otel`

OpenTelemetry observability adapter for metrics and tracing.

**Exports:**

- `.` (main): `createOtelObservabilityAdapter`

**Dependencies:**

- `queuert` as peer dependency
- `@opentelemetry/api` as peer dependency (requires ^1.9.0)

**Adapter notes:**

Users configure their OTEL SDK with desired exporters (Prometheus, OTLP, Jaeger, etc.) before using this adapter. Implements counters, histograms, and gauges; tracing spans will be added later.

**Counters emitted:**

- Worker: `{prefix}.worker.started`, `{prefix}.worker.error`, `{prefix}.worker.stopping`, `{prefix}.worker.stopped`
- Job: `{prefix}.job.created`, `{prefix}.job.attempt.started`, `{prefix}.job.attempt.taken_by_another_worker`, `{prefix}.job.attempt.already_completed`, `{prefix}.job.attempt.lease_expired`, `{prefix}.job.attempt.lease_renewed`, `{prefix}.job.attempt.failed`, `{prefix}.job.attempt.completed`, `{prefix}.job.completed`, `{prefix}.job.reaped`, `{prefix}.job.blocked`, `{prefix}.job.unblocked`
- Job Sequence: `{prefix}.job_sequence.created`, `{prefix}.job_sequence.completed`
- Notify Adapter: `{prefix}.notify_adapter.context_absence`, `{prefix}.notify_adapter.error`
- State Adapter: `{prefix}.state_adapter.error`

**Histograms emitted:**

- Job Sequence: `{prefix}.job_sequence.duration` - Duration from sequence creation to completion (ms)
- Job: `{prefix}.job.duration` - Duration from job creation to completion (ms)
- Job Attempt: `{prefix}.job.attempt.duration` - Duration of attempt processing (ms)

**Gauges emitted (UpDownCounters):**

- `{prefix}.job_type.idle` - Workers idle for this job type (can accept jobs)
  - Attributes: `typeName`, `workerId`
  - Semantics: +1 on worker start, -1 when job processing starts, +1 when job processing ends, -1 on worker stop
- `{prefix}.job_type.processing` - Jobs of this type currently being processed
  - Attributes: `typeName`, `workerId`
  - Semantics: +1 when job processing starts, -1 when job processing ends

**Configuration options:**

- `meter`: OTEL Meter instance (default: `metrics.getMeter("queuert")`)
- `metricPrefix`: Prefix for all metric names (default: `"queuert"`)

## Core Concepts

### Job

An individual unit of work. Jobs have a lifecycle: `blocked`/`pending` → `running` → `completed`. Jobs start as `blocked` if they have incomplete blockers, otherwise `pending`. Jobs can be deleted (hard-deleted from the database). Each job belongs to a JobType and contains typed input/output. Jobs track their execution attempts, scheduling, and provenance via `originId`.

### JobSequence

Like a Promise chain, a sequence of linked jobs where each job can `continueWith` to the next. The sequence completes when its final job completes without continuing. Sequence status reflects the current job in the sequence: `blocked`/`pending` → `running` → `completed`.

### JobType

Defines a named job type with its input/output types and process function. JobTypes are registered with workers via `implementJobType`. The process function receives the job (with resolved blockers accessible via `job.blockers`) and a context for continuing the sequence.

### Blockers

Jobs can depend on other job sequences. Blockers are declared at the type level with `DefineBlocker<T>` and provided via `startBlockers` callback:

```typescript
// Type declaration
defineUnionJobTypes<{
  blocker: { input: {...}; output: {...} };
  main: { input: {...}; output: {...}; blockers: [DefineBlocker<'blocker'>] };
}>()

// Usage - startBlockers callback creates blockers via startJobSequence
await queuert.startJobSequence({
  client,
  typeName: 'main',
  input: {...},
  startBlockers: async () => {
    const blocker = await queuert.startJobSequence({ client, typeName: 'blocker', input: {...} });
    return [blocker];  // Can also return existing sequences
  },
});
```

Blockers created within `startBlockers` automatically inherit the main job's `rootSequenceId` and `originId` via context propagation. Existing sequences returned from the callback keep their own `rootSequenceId`. Same pattern applies to `continueWith`. A job with incomplete blockers starts as `blocked` and transitions to `pending` when all blockers complete.

### Log

A typed logging function for observability. All job lifecycle events are logged with structured data (job IDs, queue names, worker IDs, etc.). Consumers provide their own log implementation to integrate with their logging infrastructure. A built-in `createConsoleLog()` factory provides a simple console-based logger for development and debugging.

### StateAdapter

Abstracts database operations for job persistence. Allows different database implementations (PostgreSQL, SQLite, MongoDB). Handles job creation, status transitions, leasing, and queries.

The `StateAdapter` type accepts three generic parameters:

- `TTxContext extends BaseStateAdapterContext`: Transaction context type, used within `runInTransaction` callbacks
- `TContext extends BaseStateAdapterContext`: General context type, provided by `provideContext`
- `TJobId extends string`: The job ID type used for input parameters (e.g., `jobId`, `rootSequenceIds`)

This dual-context design enables operations like migrations to run outside transactions (e.g., PostgreSQL's `CREATE INDEX CONCURRENTLY`). When transaction and general contexts are the same, use identical types for both (e.g., SQLite adapter uses `StateAdapter<TContext, TContext, TJobId>`).

**Type helpers**:

- `GetStateAdapterTxContext<TStateAdapter>`: Extracts the transaction context type
- `GetStateAdapterContext<TStateAdapter>`: Extracts the general context type
- `GetStateAdapterJobId<TStateAdapter>`: Extracts the job ID type

**Internal type design**: `StateJob` is a non-generic type with `string` for all ID fields (`id`, `rootSequenceId`, `sequenceId`, `originId`) and includes `sequenceTypeName` for sequence type tracking. The `StateAdapter` methods accept `TJobId` for input parameters but return plain `StateJob`. This simplifies internal code while allowing adapters to expose typed IDs to consumers via `GetStateAdapterJobId<TStateAdapter>`.

### StateProvider

Abstracts ORM/database client operations, providing context management, transaction handling, and SQL execution. Users create their own `StateProvider` implementation to integrate with their preferred client (raw `pg`, Drizzle, Prisma, better-sqlite3, etc.) and pass it to the state adapter factory (`createPgStateAdapter` or `createSqliteStateAdapter`).

State providers use dual-context generics matching `StateAdapter`:

- `PgStateProvider<TTxContext, TContext>` - PostgreSQL provider
- `SqliteStateProvider<TTxContext, TContext>` - SQLite provider
- `MongoStateProvider<TTxContext, TContext>` - MongoDB provider

When `TTxContext` differs from `TContext`, the provider can execute non-transactional operations via `provideContext` while ensuring transactional operations use `runInTransaction`.

**PostgreSQL adapter configuration** (`createPgStateAdapter` options):

- `stateProvider`: The PostgreSQL state provider implementation
- `schema`: Schema name for job tables (default: `"queuert"`)
- `idType`: SQL type for job IDs (default: `"uuid"`)
- `idDefault`: SQL DEFAULT expression for job IDs (default: `"gen_random_uuid()"`)
- `connectionRetryConfig`: Retry configuration for transient connection errors
- `isTransientError`: Custom function to identify transient errors

**SQLite adapter configuration** (`createSqliteStateAdapter` options):

- `stateProvider`: The SQLite state provider implementation
- `tablePrefix`: Prefix for table names (default: `"queuert_"`, set to `""` for no prefix)
- `idType`: SQL type for job ID columns (default: `"TEXT"`)
- `idGenerator`: Function returning job ID strings (default: `() => crypto.randomUUID()`). **Note:** Unlike PostgreSQL where IDs are generated in SQL, SQLite generates IDs in application code. If a custom generator returns a duplicate ID, the INSERT will fail with a PRIMARY KEY violation. The default `crypto.randomUUID()` is practically collision-free.
- `connectionRetryConfig`: Retry configuration for transient connection errors
- `isTransientError`: Custom function to identify transient errors

### NotifyAdapter

Handles pub/sub notifications for job scheduling and sequence completion. Workers listen for job scheduling notifications to wake up and process jobs immediately rather than polling. Sequence completion notifications enable `waitForJobSequenceCompletion` to respond promptly when sequences complete. Enables efficient job processing with minimal latency.

**All notifications use broadcast (pub/sub) semantics with hint-based optimization:**

- `notifyJobScheduled(typeName, count)`: Broadcasts notification with a hint count. Creates a hint key with the count and publishes the message with a unique hintId.
- `listenJobScheduled`: Workers receive the notification and atomically decrement the hint count. Only workers that successfully decrement (hint > 0) proceed to query the database. This prevents thundering herd when many workers are idle.
- `listenJobSequenceCompleted`: All listeners for the matching sequence ID receive the notification
- `listenJobOwnershipLost`: All listeners for the matching job ID receive the notification

**Hint-based optimization**: When N jobs are scheduled, the hint count is set to N. When workers receive the notification, they atomically check-and-decrement the hint using Lua scripts (Redis) or synchronous operations (in-process). Only N workers will proceed to query the database; others skip and wait for the next notification. This reduces database contention while maintaining low latency.

**Callback pattern**: All `listen*` methods accept a callback and return a dispose function:

- Async setup: `await notifyAdapter.listenJobScheduled(typeNames, callback)` - subscription is active when promise resolves
- Callback is called synchronously when a notification arrives (no race condition between setup and listening)
- Dispose function cleans up the subscription

```typescript
const dispose = await notifyAdapter.listenJobScheduled(typeNames, (typeName) => {
  // Called when notification arrives
});
try {
  // ... do work ...
} finally {
  await dispose();
}
```

### ObservabilityAdapter

Low-level adapter interface for observability metrics. Accepts primitive data types (not domain objects). When not provided, a noop implementation is used automatically. Use with `ObservabilityHelper` for domain-object-friendly interface.

**Architecture:**

- `ObservabilityAdapter`: Low-level interface accepting primitive data (`JobBasicData`, `JobProcessingData`, `JobSequenceData` from `log.ts`)
- `ObservabilityHelper`: High-level helper that wraps both `Log` and `ObservabilityAdapter`, accepts domain objects (`StateJob`, `Job`, `JobSequence`), emits to both logging and metrics

**Counters (current implementation):**

- Worker: `workerStarted`, `workerError`, `workerStopped`
- Job: `jobCreated`, `jobAttemptStarted`, `jobAttemptTakenByAnotherWorker`, `jobAttemptAlreadyCompleted`, `jobAttemptLeaseExpired`, `jobAttemptLeaseRenewed`, `jobAttemptFailed`, `jobAttemptCompleted`, `jobCompleted`, `jobReaped`
- Job Sequence: `jobSequenceCreated`, `jobSequenceCompleted`
- Blockers: `jobBlocked`, `jobUnblocked`
- Notify Adapter: `notifyContextAbsence`, `notifyAdapterError`
- State Adapter: `stateAdapterError`

### Worker

Processes jobs by polling for available work. Created via `queuert.createWorker()`, configured with `implementJobType()` for each job type it handles, then started with `start({ workerId })`. Workers automatically renew leases during staged processing and handle retries with configurable backoff.

### Reaper

Background process that reclaims expired job leases. Runs periodically to find jobs where `leased_until < now()` and resets them to `pending` status so they can be retried by any worker.

### Prepare/Complete Pattern

Job process functions use a prepare/complete pattern that splits job processing into phases:

**Process function signature**: `async ({ signal, job, prepare, complete }) => { ... }`

- `signal`: AbortSignal that fires when job is taken by another worker, job is not found, or job is completed externally (reason: `"taken_by_another_worker"`, `"error"`, `"not_found"`, or `"already_completed"`)
- `job`: The job being processed with typed input. Access resolved blockers via `job.blockers` (typed by job type definition).
- `prepare`: Function to configure prepare phase (optional - staged mode runs automatically if not called)
- `complete`: Function to complete the job (always available from process options)

**Simple process function** (staged by default):

```typescript
process: async ({ job, complete }) => {
  // Transaction already closed, lease renewal running
  return complete(() => output);
}
```

If `prepare` is not accessed, auto-setup runs in staged mode. If `complete` is called before `prepare`, auto-setup runs in atomic mode instead (entire process function runs in one transaction).

**Auto-setup behaviors**:

- If `prepare` is not accessed and `complete` is not called synchronously, auto-setup runs in staged mode
- If `complete` is called before `prepare`, auto-setup runs in atomic mode (no lease renewal between prepare and complete)
- Accessing `prepare` after auto-setup throws: "Prepare cannot be accessed after auto-setup"

**Prepare phase**: `const result = await prepare({ mode }, callback?)`

- `mode`: `"atomic"` runs entirely in one transaction; `"staged"` allows long-running work between prepare and complete with lease renewal
- Optional callback receives `{ client }` for database operations during prepare
- Returns callback result directly (or void if no callback)

**Processing phase** (staged mode only): Between prepare and complete, perform long-running work. The worker automatically renews the job lease. Implement idempotently as this phase may retry.

**Complete phase**: `return complete(({ client, continueWith }) => { ... })`

- Commits state changes in a transaction
- `continueWith` continues to the next job in the sequence
- Return value becomes the job output

### Deduplication

Two levels of deduplication prevent duplicate work:

**Sequence-level deduplication** (explicit): When starting a job sequence, provide `deduplication` options:

- `key`: Unique identifier for deduplication matching
- `strategy`: `'completed'` (default) deduplicates against non-completed jobs; `'all'` includes completed jobs
- `windowMs`: Optional time window; `undefined` means no time limit

```typescript
await queuert.startJobSequence({
  typeName: "process",
  input: { userId: 123 },
  deduplication: { key: "user-123", strategy: "completed", windowMs: 60000 }
});
```

**Continuation restriction**: `continueWith` can only be called once per complete callback. Calling it multiple times throws an error: "continueWith can only be called once". This ensures each job has a clear single continuation in the sequence.

### Continuation Types

Job types use two marker types to define their relationships:

**`DefineContinuationOutput<T>`**: Marks that a job continues to another job type. Used in the `output` type:

```typescript
'process-image': {
  input: { imageId: string };
  output: DefineContinuationOutput<"distribute-image">;
}
```

**`DefineContinuationInput<T>`**: Marks a job type as internal (can only be reached via `continueWith`, not `startJobSequence`). Wrap the input type:

```typescript
defineUnionJobTypes<{
  'public-entry': { input: { id: string }; output: DefineContinuationOutput<"internal-step"> };
  'internal-step': { input: DefineContinuationInput<{ result: number }>; output: { done: true } };
}>()
```

TypeScript prevents calling `startJobSequence` with internal job types at compile-time.

### Timeouts

Queuert does not provide built-in soft timeout functionality because:

1. **Userland solution is trivial**: Combine `AbortSignal.timeout()` with the existing `signal` parameter using `AbortSignal.any()`
2. **Lease mechanism is the hard timeout**: If a job doesn't complete within `leaseMs`, the reaper reclaims it and another worker retries

Users implement cooperative timeouts in their process functions:

```typescript
process: async ({ signal, job, complete }) => {
  const timeout = AbortSignal.timeout(30_000);
  const combined = AbortSignal.any([signal, timeout]);

  // Use combined signal for cancellable operations
  await fetch(url, { signal: combined });

  return complete(() => output);
}
```

For hard timeouts (forceful termination), the lease mechanism already handles this - configure `leaseMs` appropriately for the job type.

### Workerless Completion

Jobs can be completed without a worker using `completeJobSequence` (sets `workerId: null`). This enables approval workflows, webhook-triggered completions, and other patterns where jobs wait for events outside worker processing.

```typescript
await queuert.completeJobSequence({
  client,
  typeName: "awaiting-approval",
  id: jobSequence.id,
  complete: async ({ job, complete }) => {
    // Inspect current job state
    if (job.status === "blocked") {
      // Can complete blockers first if needed
    }

    // Complete with output (completes the job)
    await complete(job, async () => ({ approved: true }));

    // Or continue to next job in sequence
    await complete(job, async ({ continueWith }) =>
      continueWith({ typeName: "process-approved", input: { ... } })
    );
  },
});
```

**Key behaviors**:

- Must be called within a transaction (uses `FOR UPDATE` lock on current job)
- `complete` callback receives current job, can call inner `complete` multiple times for multi-step sequences
- Partial completion supported: complete one job and leave the next pending
- Can complete blocked jobs (user's responsibility to handle/compensate blockers)
- Running workers detect completion by others via `JobAlreadyCompletedError` and abort signal with reason `"already_completed"`

## Design Philosophy

### First Job = Sequence (Unified Model)

A JobSequence is not a separate entity - it's simply identified by its first job. The first job's ID becomes the sequence's ID (`sequenceId`). This mirrors how JavaScript Promises work:

```javascript
// In JavaScript, a Promise chain IS the first promise:
const chain = fetch(url)        // chain === this promise
  .then(processResponse)        // continuation
  .then(formatResult);          // continuation

// In Queuert, a sequence IS its first job:
const sequence = startJobSequence(...)  // sequence.id === firstJob.id
  .continueWith(processStep)            // continuation
  .continueWith(formatStep);            // continuation
```

A Promise chain doesn't have a separate "chain ID" - the original promise IS the chain's identity. Similarly, in Queuert: **the first job IS the sequence**.

This unification provides:

**Simplicity**: One table, one type, one set of operations. No separate `job_sequence` table to manage, no joins, no synchronization issues.

**Flexibility**: The first job can be:

- A lightweight "alias" that immediately continues to real work
- A full job that does processing and completes the sequence in one step
- Anything in between

**Self-referential identity**: For the first job in a sequence, `job.id === job.sequenceId`. This isn't redundant - it's a meaningful signal that identifies the sequence starter. Continuation jobs have `job.id !== job.sequenceId` but share the same `sequenceId` as all other jobs in the sequence.

**Denormalization tradeoff**: `sequenceTypeName` is stored on every job for O(1) sequence-type filtering at scale. Without it, queries like `SELECT * FROM job WHERE status = 'running' AND sequence_id IN (SELECT id FROM job WHERE id = sequence_id AND type_name = 'batch-import')` become expensive with millions of records.

**Junction table for blockers**: The `job_blocker` table is required for M:N blocker relationships (efficient bidirectional lookup). This is the only "extra" table beyond the unified job model.

### Consistent Terminology

Parallel entities should use consistent lifecycle terminology to reduce cognitive load:

- Job: `blocked`/`pending` → `running` → `completed`
- JobSequence: `blocked`/`pending` → `running` → `completed` (reflects status of current job in sequence)

Avoid asymmetric naming (e.g., `started`/`finished` vs `created`/`completed`) even if individual terms seem natural - consistency across the API produces fewer questions.

### Async Factory Pattern

Public-facing adapter factories that may perform I/O are async for consistency:

- `createQueuert` → `Promise<Queuert>`
- `createPgStateAdapter` → `Promise<StateAdapter>`
- `createSqliteStateAdapter` → `Promise<StateAdapter>`
- `createPgNotifyAdapter` → `Promise<NotifyAdapter>`
- `createRedisNotifyAdapter` → `Promise<NotifyAdapter>`
- `createNatsNotifyAdapter` → `Promise<NotifyAdapter>`

In-process and internal-only factories remain sync since they have no I/O:

- `createInProcessStateAdapter` → `StateAdapter`
- `createInProcessNotifyAdapter` → `NotifyAdapter`
- `createNoopNotifyAdapter` → `NotifyAdapter`

### Naming Conventions

- `originId`: Tracks provenance (which job triggered this one), null for root jobs
- `rootSequenceId`: ID of the root sequence (ultimate ancestor of a job tree), self-referential for root sequences (equals own ID, not null)
- `sequenceId`: The job sequence this job belongs to, self-referential for the first job (equals own ID)
- `sequenceTypeName`: The job type name of the first job in a sequence (correlates with `sequenceId` - both reference the starting job)
- `typeName`: On `JobSequence`, this is the sequence's entry type (cleaner public API, equivalent to `sequenceTypeName` on jobs)
- `blockers`/`blocked`: Describes job dependencies (not `dependencies`/`dependents`)
- `continueWith`: Continues to next job in complete callback
- `process`: The job processing function provided to `implementJobType` (not `handler`). Receives `{ signal, job, prepare, complete }` and returns the completed job or continuation.
- `JobAbortReason`: Union type of abort reasons for job processing: `"taken_by_another_worker" | "error" | "not_found" | "already_completed"`. Used with `TypedAbortSignal` in process functions.
- `TypedAbortSignal<T>`: Generic abort signal type with typed `reason` property. Process functions receive `TypedAbortSignal<JobAbortReason>` to enable type-safe abort reason checking.
- `prepare`: Unified function for both atomic and staged modes via `mode` parameter (not separate `prepareAtomic`/`prepareStaged`)
- `lease`/`leased`: Time-bounded exclusive claim on a job during processing (not `lock`/`locked`). Use `leasedBy`, `leasedUntil`, `leaseMs`, `leaseDurationMs`. DB columns use `leased_by`, `leased_until`.
- `completedBy`: Records which worker completed the job (`workerId` string), or `null` for workerless completion. DB column uses `completed_by`. Available on completed jobs.
- `deduplicationKey`: Explicit key for sequence-level deduplication. DB column uses `deduplication_key`.
- `deduplicated`: Boolean flag returned when a job/sequence was deduplicated instead of created.
- `DefineContinuationInput<T>`: Type wrapper marking job types as internal (only reachable via `continueWith`).
- `DefineContinuationOutput<T>`: Type marker in output indicating continuation to another job type.
- `DefineBlocker<T>`: Type marker for declaring blocker dependencies. Used in `blockers` field of job type definitions.
- `startBlockers`: Callback parameter in `startJobSequence` and `continueWith` for providing blockers. Required when job type has blockers defined; must not be provided when job type has no blockers. Create new blocker sequences via `startJobSequence` within the callback - they automatically inherit rootSequenceId/originId from the main job via context propagation. Can also return existing sequences.
- `deleteJobSequences`: Deletes entire job trees by `rootSequenceId`. Accepts `rootSequenceIds` array parameter. Must be called on root sequences. Throws error if external job sequences depend on sequences being deleted; include those dependents in the deletion set to proceed. Primarily intended for testing environments.
- `completeJobSequence`: Completes jobs without a worker (`workerId: null`). Takes a `complete` callback that receives the current job and can complete it (with output or continuation). Supports partial completion and multi-step sequences.
- `waitForJobSequenceCompletion`: Waits for a job sequence to complete. Uses a hybrid polling/notification approach with 100ms poll intervals for reliability. Throws `WaitForJobSequenceCompletionTimeoutError` on timeout. Throws immediately if sequence doesn't exist.
- `withNotify`: Wraps a callback to collect and dispatch notifications after successful completion. Used to batch job scheduling and sequence completion notifications within a transaction.
- `notifyJobOwnershipLost` / `listenJobOwnershipLost`: Notification channel for job ownership loss. When a job's ownership is lost outside its process function (reaper reaps it, workerless completion), the process function is notified immediately via this channel. Workers in staged mode listen for these notifications and abort their signal with the appropriate reason (`"taken_by_another_worker"` or `"already_completed"`).
- `JobNotFoundError`: Error thrown when a job or job sequence is not found (e.g., deleted during processing, or waiting for non-existent sequence).
- `JobTakenByAnotherWorkerError`: Error thrown when a worker detects another worker has taken over the job (lease was acquired by someone else).
- `JobAlreadyCompletedError`: Error thrown when attempting to complete a job that was already completed (by another worker or workerless completion).
- `WaitForJobSequenceCompletionTimeoutError`: Error thrown when `waitForJobSequenceCompletion` times out before the sequence completes.
- `StateNotInTransactionError`: Error thrown when operations requiring a transaction (e.g., `startJobSequence`, `deleteJobSequences`, `completeJobSequence`) are called outside a transaction context.
- `wrapStateAdapterWithLogging`: Helper function that wraps a `StateAdapter` to log errors via `LogHelper.stateAdapterError` before re-throwing. Infrastructure methods (`provideContext`, `runInTransaction`, `isInTransaction`) are passed through without wrapping.
- `wrapNotifyAdapterWithLogging`: Helper function that wraps a `NotifyAdapter` to log errors via `LogHelper.notifyAdapterError` before re-throwing.
- `wrapStateAdapterWithRetry`: Helper function that wraps a `StateAdapter` with retry logic for transient errors. Infrastructure methods are passed through without wrapping.
- `ScheduleOptions`: Discriminated union type for deferred scheduling: `{ at: Date; afterMs?: never }` or `{ at?: never; afterMs: number }`. Used with `schedule` parameter in `startJobSequence` and `continueWith`.
- `schedule`: Optional parameter in `startJobSequence` and `continueWith` for deferred job execution. Accepts `ScheduleOptions`. Jobs are created transactionally but not processable until the specified time. `afterMs` is computed at the database level using `now() + interval` to avoid clock skew.
- `rescheduleJob`: Helper function to reschedule a job from within a process function. Takes `ScheduleOptions` and optional cause. Throws `RescheduleJobError`.
- `RescheduleJobError`: Error class with `schedule: ScheduleOptions` property. Used by `rescheduleJob` helper.

### Type Helpers

- `JobOf<TJobId, TJobTypeDefinitions, TJobTypeName, TSequenceTypeName?>`: Resolves to `Job<TJobId, TJobTypeName, Input, BlockerSequences, SequenceTypeName>` from job type definitions. Automatically unwraps `DefineContinuationInput` markers and includes typed blocker sequences. The optional 4th parameter `TSequenceTypeName` defaults to `SequenceTypesReaching<TJobTypeDefinitions, TJobTypeName>` (union of all sequence types that can reach this job type).
- `JobWithoutBlockers<TJob>`: Strips the `blockers` field from a `Job` type. Used in `startBlockers` callback where blockers haven't been created yet. Example: `JobWithoutBlockers<JobOf<string, Defs, "process">>`.
- `PendingJob<TJob>`, `BlockedJob<TJob>`, `RunningJob<TJob>`, `CompletedJob<TJob>`, `CreatedJob<TJob>`: Job status types that take a `Job` type and narrow by status. Example: `PendingJob<JobOf<string, Defs, "process">>`.
- `SequenceJobTypes<TJobTypeDefinitions, TSequenceTypeName>`: Union of all job type names reachable in a sequence starting from `TSequenceTypeName`.
- `SequenceTypesReaching<TJobTypeDefinitions, TJobTypeName>`: Inverse of `SequenceJobTypes`. Given a job type, computes the union of all sequence types (external job types) that can reach it. For entry jobs, this is their own type; for continuation-only jobs, this is the union of all entry types that eventually continue to them.
- `ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>`: Job type names that `TJobTypeName` can continue to.
- `ExternalJobTypeDefinitions<T>`: Filters job type definitions to only external job types that can be started via `startJobSequence` (excludes internal `DefineContinuationInput` types).
- `HasBlockers<TJobTypeDefinitions, TJobTypeName>`: Returns `true` if the job type has blockers defined, `false` otherwise. Used internally to enforce `startBlockers` requirement.
- `JobSequenceOf<TJobId, TJobTypeDefinitions, TJobTypeName>`: Resolves to `JobSequence<TJobId, TJobTypeName, Input, Output>` for all jobs reachable in the sequence.
- `BlockerSequences<TJobId, TJobTypeDefinitions, TJobTypeName>`: Tuple of `JobSequence` types for all declared blockers of a job type.

### Type Organization

- `job-type.ts`: Public marker types (`DefineContinuationInput`, `DefineContinuationOutput`, `DefineBlocker`) and their symbols. Re-exports navigation types.
- `job-type.navigation.ts`: Type-level navigation logic (`JobOf`, `SequenceJobTypes`, `ContinuationJobTypes`, `ExternalJobTypeDefinitions`, blocker resolution types).
- `job-sequence.types.ts`: Core entity types (`JobSequence`, `CompletedJobSequence`, `JobSequenceStatus`).
- `job.types.ts`: Core job entity types (`Job`, `JobWithoutBlockers`) and status narrowing types (`PendingJob`, `RunningJob`, etc.).

## Testing Patterns

- Embed small verification tests into existing related tests rather than creating separate ones
- Test all relevant phases: `prepare`, `process`, `complete`
- Prefer descriptive test names that match what's being tested
- To enable verbose logging when debugging tests, run with `DEBUG=1` environment variable (e.g., `DEBUG=1 pnpm test`)

### Test Suites

Test suites are reusable test collections exported as functions. They receive Vitest's `it` function and a typed context, allowing the same tests to run across different configurations (e.g., different database adapters).

```typescript
// Define a test suite
export const myFeatureTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("does something", async ({ stateAdapter, runInTransaction, expect }) => {
    // test implementation
  });

  it("does something else", async ({ stateAdapter, expect }) => {
    // test implementation
  });
};

// Use the test suite in a spec file
describe("MyFeature", () => {
  myFeatureTestSuite({ it });
});
```

**File organization:**

- `packages/core/src/suites/` - Reusable test suite files (`*.test-suite.ts`) and shared context helpers (`spec-context.spec-helper.ts`), exported via `queuert/testing`
- `packages/core/src/specs/` - Spec files (`*.spec.ts`) that run test suites with in-process adapters
- `packages/postgres/src/specs/` - Spec files that run the same test suites with PostgreSQL adapter
- `packages/sqlite/src/specs/` - Spec files that run the same test suites with SQLite adapter
- `packages/redis/src/specs/` - Spec files that run the same test suites with Redis notify adapter
- `packages/nats/src/specs/` - Spec files that run the same test suites with NATS notify adapter
- State adapter test helpers (`extendWithStateInProcess`, `extendWithStatePostgres`, `extendWithStateSqlite`) configure the test context with the appropriate state adapter
- Notify adapter test helpers (`extendWithNotifyInProcess`, `extendWithNotifyNoop`, `extendWithNotifyRedis`, `extendWithNatsNotify`) configure the test context with the appropriate notify adapter

## Code Style

- Inline types used in only one place
- Remove obvious comments
- Merge similar functionality
- Before implementing new features, search for similar existing implementations and ask if refactoring/reuse is preferred
- Use typed error classes instead of generic `new Error()`. All public-facing errors should be properly typed (e.g., `JobNotFoundError`, `JobAlreadyCompletedError`) to enable proper error handling by consumers. Internal assertion errors (e.g., "Prepare can only be called once") can remain as generic errors.

## Session Requirements

- End each agentic session only when all checks pass: `pnpm check` (runs lint, fmt:check, typecheck, test); run `pnpm fmt` before running checks to fix formatting issues. There are separate commands like `pnpm lint`, `pnpm typecheck` and `pnpm test`.
- Update documentation in README.md if there were changes to public API
- Update knowledge base in CLAUDE.md if there were architectural changes
- Update todos in TODO.md if any were addressed
