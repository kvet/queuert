# Queuert Code Style Guide

## License

MIT License - see [LICENSE](LICENSE) for details.

## Project Structure

Queuert is a monorepo with the following packages:

### `@queuert/core`

Core abstractions, interfaces, and in-memory implementations for testing.

**Exports:**

- `.` (main): `createQueuert`, adapter interfaces (`StateAdapter`, `NotifyAdapter`), type definitions, error classes, in-process adapters (`createInProcessStateAdapter`, `createInProcessNotifyAdapter`, `createNoopNotifyAdapter`)
- `./testing`: Test suites and context helpers for adapter packages (`processTestSuite`, `sequencesTestSuite`, etc., `extendWithCommon`, `extendWithStateInProcess`)
- `./internal`: Internal utilities for adapter packages only (`withRetry`)

### `@queuert/postgres`

PostgreSQL state adapter implementation. Users provide their own `pg` client.

**Exports:**

- `.` (main): `createPgStateAdapter`, `PgStateAdapter` type
- `./testing`: Test helper for PostgreSQL tests (`extendWithStatePostgres`)

**Dependencies:**

- `@queuert/core` as peer dependency

### `@queuert/sqlite`

SQLite state adapter implementation using better-sqlite3.

**Exports:**

- `.` (main): `createSqliteStateAdapter`, `SqliteStateAdapter` type
- `./testing`: Test helper for SQLite tests (`extendWithStateSqlite`)

**Dependencies:**

- `@queuert/core` as peer dependency

### `@queuert/redis`

Redis notify adapter implementation for distributed pub/sub notifications.

**Exports:**

- `.` (main): `createRedisNotifyAdapter`, `CreateRedisNotifyAdapterOptions` type
- `./testing`: Test helper for Redis tests (`extendWithNotifyRedis`)

**Dependencies:**

- `@queuert/core` as peer dependency

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
  firstJobTypeName: 'main',
  input: {...},
  startBlockers: async () => {
    const blocker = await queuert.startJobSequence({ client, firstJobTypeName: 'blocker', input: {...} });
    return [blocker];  // Can also return existing sequences
  },
});
```

Blockers created within `startBlockers` automatically inherit the main job's `rootId` and `originId` via context propagation. Existing sequences returned from the callback keep their own `rootId`. Same pattern applies to `continueWith`. A job with incomplete blockers starts as `blocked` and transitions to `pending` when all blockers complete.

### Log

A typed logging function for observability. All job lifecycle events are logged with structured data (job IDs, queue names, worker IDs, etc.). Consumers provide their own log implementation to integrate with their logging infrastructure.

### StateAdapter

Abstracts database operations for job persistence. Allows different database implementations (PostgreSQL and SQLite). Handles job creation, status transitions, leasing, and queries.

The `StateAdapter` type accepts two generic parameters:

- `TContext extends BaseStateAdapterContext`: The context type containing database client
- `TJobId`: The job ID type used for input parameters (e.g., `jobId`, `rootIds`)

**Internal type design**: `StateJob` is a non-generic type with `string` for all ID fields (`id`, `rootId`, `sequenceId`, `originId`). The `StateAdapter` methods accept `TJobId` for input parameters but return plain `StateJob`. This simplifies internal code while allowing adapters to expose typed IDs to consumers via `GetStateAdapterJobId<TStateAdapter>`.

### StateProvider

Abstracts ORM/database client operations, providing context management, transaction handling, and SQL execution. Users create their own `StateProvider` implementation to integrate with their preferred client (raw `pg`, Drizzle, Prisma, better-sqlite3, etc.) and pass it to the state adapter factory (`createPgStateAdapter` or `createSqliteStateAdapter`).

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

**IMPORTANT - Two notification primitives with different semantics (must be consistent across all adapter implementations):**

1. **Queue primitive** (`listenJobScheduled`): Only ONE waiting worker receives each notification. Workers compete via the notification layer itself (e.g., Redis `lpush`/`brpop`), not just the database lock. This prevents thundering herd when many workers are idle.

2. **Pub/Sub primitive** (`listenJobSequenceCompleted`, `listenJobOwnershipLost`): All listeners for the matching ID receive the notification (e.g., Redis `publish`/`subscribe`). Used for targeted notifications where a specific listener needs to wake up.

**Listener pattern**: All `listen*` methods return a `Listener<T>` with:

- Async setup: `await notifyAdapter.listenJobScheduled(typeNames)` - subscription is active when promise resolves
- `wait(opts?)`: Waits for an event, returns `{ received: true, value: T }` or `{ received: false }` (aborted/disposed)
- `dispose()`: Cleans up the subscription (also aborts pending `wait()` calls)
- `[Symbol.asyncDispose]`: Supports `await using` for automatic cleanup

```typescript
// Usage with await using (recommended)
await using listener = await notifyAdapter.listenJobScheduled(typeNames);
const result = await listener.wait({ signal });
if (result.received) {
  // Event happened, result.value contains the data
}
// Auto-disposed at block end

// Usage with explicit dispose
const listener = await notifyAdapter.listenJobScheduled(typeNames);
try {
  const result = await listener.wait({ signal });
} finally {
  await listener.dispose();
}
```

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
  firstJobTypeName: "process",
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

### Workerless Completion

Jobs can be completed without a worker using `completeJobSequence` (sets `workerId: null`). This enables approval workflows, webhook-triggered completions, and other patterns where jobs wait for events outside worker processing.

```typescript
await queuert.completeJobSequence({
  client,
  firstJobTypeName: "awaiting-approval",
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

### Consistent Terminology

Parallel entities should use consistent lifecycle terminology to reduce cognitive load:

- Job: `blocked`/`pending` → `running` → `completed`
- JobSequence: `blocked`/`pending` → `running` → `completed` (reflects status of current job in sequence)

Avoid asymmetric naming (e.g., `started`/`finished` vs `created`/`completed`) even if individual terms seem natural - consistency across the API produces fewer questions.

### Naming Conventions

- `originId`: Tracks provenance (which job triggered this one), null for root jobs
- `rootId`: Ultimate ancestor of a job tree, self-referential for root jobs (equals own ID, not null)
- `sequenceId`: The job sequence this job belongs to, self-referential for the first job (equals own ID)
- `firstJobTypeName`: The job type name of the first job in a sequence (correlates with `sequenceId` - both reference the starting job)
- `blockers`/`blocked`: Describes job dependencies (not `dependencies`/`dependents`)
- `continueWith`: Continues to next job in complete callback
- `process`: The job processing function provided to `implementJobType` (not `handler`). Receives `{ signal, job, prepare, complete }` and returns the completed job or continuation.
- `prepare`: Unified function for both atomic and staged modes via `mode` parameter (not separate `prepareAtomic`/`prepareStaged`)
- `lease`/`leased`: Time-bounded exclusive claim on a job during processing (not `lock`/`locked`). Use `leasedBy`, `leasedUntil`, `leaseMs`, `leaseDurationMs`. DB columns use `leased_by`, `leased_until`.
- `completedBy`: Records which worker completed the job (`workerId` string), or `null` for workerless completion. DB column uses `completed_by`. Available on completed jobs.
- `deduplicationKey`: Explicit key for sequence-level deduplication. DB column uses `deduplication_key`.
- `deduplicated`: Boolean flag returned when a job/sequence was deduplicated instead of created.
- `DefineContinuationInput<T>`: Type wrapper marking job types as internal (only reachable via `continueWith`).
- `DefineContinuationOutput<T>`: Type marker in output indicating continuation to another job type.
- `DefineBlocker<T>`: Type marker for declaring blocker dependencies. Used in `blockers` field of job type definitions.
- `startBlockers`: Callback parameter in `startJobSequence` and `continueWith` for providing blockers. Required when job type has blockers defined; must not be provided when job type has no blockers. Create new blocker sequences via `startJobSequence` within the callback - they automatically inherit rootId/originId from the main job via context propagation. Can also return existing sequences.
- `deleteJobSequences`: Deletes entire job trees by `rootId`. Accepts array of sequence IDs. Must be called on root sequences. Throws error if external job sequences depend on sequences being deleted; include those dependents in the deletion set to proceed. Primarily intended for testing environments.
- `completeJobSequence`: Completes jobs without a worker (`workerId: null`). Takes a `complete` callback that receives the current job and can complete it (with output or continuation). Supports partial completion and multi-step sequences.
- `waitForJobSequenceCompletion`: Waits for a job sequence to complete. Uses a hybrid polling/notification approach with 100ms poll intervals for reliability. Throws `WaitForJobSequenceCompletionTimeoutError` on timeout. Throws immediately if sequence doesn't exist.
- `withNotify`: Wraps a callback to collect and dispatch notifications after successful completion. Used to batch job scheduling and sequence completion notifications within a transaction.
- `notifyJobOwnershipLost` / `listenJobOwnershipLost`: Notification channel for job ownership loss. When a job's ownership is lost outside its process function (reaper reaps it, workerless completion), the process function is notified immediately via this channel. Workers in staged mode listen for these notifications and abort their signal with the appropriate reason (`"taken_by_another_worker"` or `"already_completed"`).
- `Listener<T>`: Subscription handle returned by `listen*` methods. Has `wait()` for receiving events, `dispose()` for cleanup, and supports `await using`.
- `ListenResult<T>`: Return type of `Listener.wait()`. Either `{ received: true, value: T }` or `{ received: false }`.
- `JobNotFoundError`: Error thrown when a job or job sequence is not found (e.g., deleted during processing, or waiting for non-existent sequence).
- `JobTakenByAnotherWorkerError`: Error thrown when a worker detects another worker has taken over the job (lease was acquired by someone else).
- `JobAlreadyCompletedError`: Error thrown when attempting to complete a job that was already completed (by another worker or workerless completion).
- `WaitForJobSequenceCompletionTimeoutError`: Error thrown when `waitForJobSequenceCompletion` times out before the sequence completes.

### Type Helpers

- `JobOf<TJobId, TJobTypeDefinitions, TJobTypeName>`: Resolves to `Job<TJobId, TJobTypeName, Input, BlockerSequences>` from job type definitions. Automatically unwraps `DefineContinuationInput` markers and includes typed blocker sequences.
- `JobWithoutBlockers<TJob>`: Strips the `blockers` field from a `Job` type. Used in `startBlockers` callback where blockers haven't been created yet. Example: `JobWithoutBlockers<JobOf<string, Defs, "process">>`.
- `PendingJob<TJob>`, `BlockedJob<TJob>`, `RunningJob<TJob>`, `CompletedJob<TJob>`, `CreatedJob<TJob>`: Job status types that take a `Job` type and narrow by status. Example: `PendingJob<JobOf<string, Defs, "process">>`.
- `SequenceJobTypes<TJobTypeDefinitions, TFirstJobTypeName>`: Union of all job type names reachable in a sequence starting from `TFirstJobTypeName`.
- `ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>`: Job type names that `TJobTypeName` can continue to.
- `FirstJobTypeDefinitions<T>`: Filters job type definitions to only those that can start a sequence (excludes `DefineContinuationInput` types).
- `HasBlockers<TJobTypeDefinitions, TJobTypeName>`: Returns `true` if the job type has blockers defined, `false` otherwise. Used internally to enforce `startBlockers` requirement.
- `JobSequenceOf<TJobId, TJobTypeDefinitions, TJobTypeName>`: Resolves to `JobSequence<TJobId, TJobTypeName, Input, Output>` for all jobs reachable in the sequence.
- `BlockerSequences<TJobId, TJobTypeDefinitions, TJobTypeName>`: Tuple of `JobSequence` types for all declared blockers of a job type.

### Type Organization

- `job-type.ts`: Public marker types (`DefineContinuationInput`, `DefineContinuationOutput`, `DefineBlocker`) and their symbols. Re-exports navigation types.
- `job-type.navigation.ts`: Type-level navigation logic (`JobOf`, `SequenceJobTypes`, `ContinuationJobTypes`, `FirstJobTypeDefinitions`, blocker resolution types).
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

- `packages/core/src/suites/` - Reusable test suite files (`*.test-suite.ts`) and shared context helpers (`spec-context.spec-helper.ts`), exported via `@queuert/core/testing`
- `packages/core/src/specs/` - Spec files (`*.spec.ts`) that run test suites with in-process adapters
- `packages/postgres/src/specs/` - Spec files that run the same test suites with PostgreSQL adapter
- `packages/sqlite/src/specs/` - Spec files that run the same test suites with SQLite adapter
- `packages/redis/src/specs/` - Spec files that run the same test suites with Redis notify adapter
- State adapter test helpers (`extendWithStateInProcess`, `extendWithStatePostgres`, `extendWithStateSqlite`) configure the test context with the appropriate state adapter
- Notify adapter test helpers (`extendWithNotifyInProcess`, `extendWithNotifyNoop`, `extendWithNotifyRedis`) configure the test context with the appropriate notify adapter

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
