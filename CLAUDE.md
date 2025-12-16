# Queuert Code Style Guide

## Core Concepts

### Job
An individual unit of work. Jobs have a lifecycle: `created` → `blocked`/`pending` → `running` → `completed`. Jobs can be deleted (hard-deleted from the database). Each job belongs to a JobType and contains typed input/output. Jobs track their execution attempts, scheduling, and provenance via `originId`.

### JobSequence
Like a Promise chain, a sequence of linked jobs where each job can `continueWith` to the next. The sequence completes when its final job completes without continuing. Sequences have a simple lifecycle: `created` → `completed`.

### JobType
Defines a named job type with its input/output types and handler. JobTypes are registered with workers via `implementJobType`. The handler receives the job, its resolved blockers, and a context for continuing the sequence.

### Blockers
Jobs can depend on other job sequences. A job with blockers enters `blocked` status until all blocker sequences complete. Once complete, the job transitions to `pending` and can be processed.

### Log
A typed logging function for observability. All job lifecycle events are logged with structured data (job IDs, queue names, worker IDs, etc.). Consumers provide their own log implementation to integrate with their logging infrastructure.

### StateAdapter
Abstracts database operations for job persistence. Allows different database implementations (currently PostgreSQL). Handles job creation, status transitions, leasing, and queries.

### StateProvider
Abstracts ORM/database client operations. Provides context management, transaction handling, and SQL execution. Allows integration with different ORMs (e.g., Drizzle, Prisma, raw pg).

### NotifyAdapter
Handles worker notification when jobs are scheduled. Workers listen for notifications to wake up and process jobs immediately rather than polling. Enables efficient job processing with minimal latency.

### Prepare/Finalize Pattern
Job handlers use a prepare/finalize pattern that splits job processing into phases:

**Handler signature**: `async ({ signal, job, blockers, prepare }) => { ... }`
- `signal`: AbortSignal that fires when lease expires or job is deleted (reason: `"lease_expired"`, `"error"`, or `"deleted"`)
- `job`: The job being processed with typed input
- `blockers`: Resolved blocker sequences (typed by job type definition)
- `prepare`: Function to enter prepare phase

**Prepare phase**: `const [{ finalize }] = await prepare({ mode }, callback?)`
- `mode`: `"atomic"` runs entirely in one transaction; `"staged"` allows long-running work between prepare and finalize with lease renewal
- Optional callback receives `{ client }` for database operations during prepare
- Returns finalize function (and callback result if provided)

**Processing phase** (staged mode only): Between prepare and finalize, perform long-running work. The worker automatically renews the job lease. Implement idempotently as this phase may retry.

**Finalize phase**: `return finalize(({ client, continueWith }) => { ... })`
- Commits state changes in a transaction
- `continueWith` continues to the next job in the sequence
- Return value becomes the job output

### Deduplication
Two levels of deduplication prevent duplicate work:

**Sequence-level deduplication** (explicit): When starting a job sequence, provide `deduplication` options:
- `key`: Unique identifier for deduplication matching
- `strategy`: `'finalized'` (default) deduplicates against non-completed jobs; `'all'` includes completed jobs
- `windowMs`: Optional time window; `undefined` means no time limit

```typescript
await queuert.startJobSequence({
  firstJobTypeName: "process",
  input: { userId: 123 },
  deduplication: { key: "user-123", strategy: "finalized", windowMs: 60000 }
});
```

**Continuation restriction**: `continueWith` can only be called once per finalize callback. Calling it multiple times throws an error: "continueWith can only be called once". This ensures each job has a clear single continuation in the sequence.

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

## Design Philosophy

### Consistent Terminology
Parallel entities should use consistent lifecycle terminology to reduce cognitive load:
- Job: `created` → `blocked`/`pending` → `running` → `completed`
- JobSequence: `created` → `blocked`/`pending` → `running` → `completed` (reflects status of current job in sequence)

Avoid asymmetric naming (e.g., `started`/`finished` vs `created`/`completed`) even if individual terms seem natural - consistency across the API produces fewer questions.

### Naming Conventions
- `originId`: Tracks provenance (which job triggered this one), null for root jobs
- `rootId`: Ultimate ancestor of a job tree, self-referential for root jobs (equals own ID, not null)
- `sequenceId`: The job sequence this job belongs to, self-referential for the first job (equals own ID)
- `firstJobTypeName`: The job type name of the first job in a sequence (correlates with `sequenceId` - both reference the starting job)
- `blockers`/`blocked`: Describes job dependencies (not `dependencies`/`dependents`)
- `continueWith`: Continues to next job in finalize callback
- `prepare`: Unified function for both atomic and staged modes via `mode` parameter (not separate `prepareAtomic`/`prepareStaged`)
- `lease`/`leased`: Time-bounded exclusive claim on a job during processing (not `lock`/`locked`). Use `leasedBy`, `leasedUntil`, `leaseMs`, `leaseDurationMs`. DB columns use `leased_by`, `leased_until`.
- `deduplicationKey`: Explicit key for sequence-level deduplication. DB column uses `deduplication_key`.
- `deduplicated`: Boolean flag returned when a job/sequence was deduplicated instead of created.
- `DefineContinuationInput<T>`: Type wrapper marking job types as internal (only reachable via `continueWith`).
- `DefineContinuationOutput<T>`: Type marker in output indicating continuation to another job type.
- `deleteJobSequences`: Deletes entire job trees by `rootId`. Accepts array of sequence IDs. Must be called on root sequences. Throws error if external job sequences depend on sequences being deleted; include those dependents in the deletion set to proceed. Primarily intended for testing environments.
- `JobDeletedError`: Error thrown when a running job detects it has been deleted during lease renewal.

## Testing Patterns

- Embed small verification tests into existing related tests rather than creating separate ones
- Test all relevant phases: `prepare`, `process`, `finalize`
- Prefer descriptive test names that match what's being tested

## Code Style

- Inline types used in only one place
- Remove obvious comments
- Merge similar functionality

## Session Requirements

- End each agentic session only when all checks pass: `pnpm check` (runs lint, fmt:check, typecheck, test); run `pnpm fmt` before running checks to fix formatting issues
- Update documentation in README.md if there were changes to public API
- Update knowledge base in CLAUDE.md if there were architectural changes
- Update todos in TODO.md if any were addressed
