# Client

## Overview

The client is the public API for managing job chains. Created via `createClient()`.

## Methods

The client has two categories of methods: mutating and read-only.

**Mutating** — `startJobChain`, `completeJobChain`, `deleteJobChains`. Require `transactionHooks` and a transaction context. Side effects (notifications, observability) are buffered via hooks and only flushed after the caller's transaction commits.

**Read-only** — `getJobChain`, `getJob`, `listJobChains`, `listJobs`, `listJobChainJobs`, `getJobBlockers`, `listBlockedJobs`, `awaitJobChain`. Do not require `transactionHooks`. Accept an optional transaction context — when omitted, the adapter acquires its own connection.

All methods accept a transaction context: required for mutations (rollback safety for side effects), optional for queries (standalone reads are fine).

### Mutation Methods

All mutation methods require `transactionHooks` and a transaction context. Side effects are buffered and flushed after the caller's transaction commits.

**`startJobChain`** — create a new job chain. Takes `typeName`, typed `input`, optional `blockers`, `deduplication`, and `schedule`. Returns the created `JobChain<...>` with a `deduplicated` flag. The return type narrows to the specified chain type.

**`completeJobChain`** — complete a chain from outside a worker. Takes `typeName`, `id`, and a `complete` callback. The caller receives the current job and a `complete` function, which can optionally call `continueWith` to extend the chain. This is the same prepare/complete pattern used by the worker (see [Job Processing](job-processing.md)), but driven by the caller instead. See [Workerless Completion](workerless-completion.md).

**`deleteJobChains`** — delete chains by ID. Takes `ids` and optional `cascade`. Returns the deleted `JobChain<...>[]`. Throws if external jobs depend on them as blockers. When `cascade` is true, expands the set to include transitive dependencies before deleting. See [Deletion](deletion.md).

### Query Methods

All query methods accept an optional transaction context. Paginated methods use cursor-based pagination (`Page<T>` with `nextCursor`) consistent with the state adapter.

#### Single-entity lookups

**`getJobChain`** — get a single chain by ID. Returns `JobChain<...> | null`. Takes `typeName` and `id` — the return type narrows to the specified chain type.

**`getJob`** — get a single job by ID. Returns `Job<...> | null`. Takes `typeName` and `id` — the return type narrows to the specified job type.

#### Paginated lists

All paginated methods accept `cursor?: string` and `limit?: number` for cursor-based pagination. Date range bounds (`from`, `to`) accept either an absolute date (`{ at: Date }`) or a relative offset from now (`{ beforeMs: number }`). All `orderBy` and `orderDirection` parameters are optional — default to `orderBy: 'created'`, `orderDirection: 'desc'` (newest first) unless noted otherwise.

**`listJobChains`** — paginated list of chains. Returns `Page<JobChain<...>>`. Filters:

- `typeName?: TChainTypeName[]` — chain type names
- `id?: TJobId[]` — filter by chain IDs
- `jobId?: TJobId[]` — find chains containing these job IDs. Not indexed — expensive on large datasets
- `root?: boolean` — when true, excludes chains referenced as blockers by other jobs
- `status?: JobChainStatus[]` — filter by chain status. Derived from last job — not indexed, slow on large datasets. May be deferred to a later release
- `from?: DateBound` — lower bound on `createdAt`
- `to?: DateBound` — upper bound on `createdAt`
- `orderBy?: 'created'` — default `'created'`
- `orderDirection?: 'asc' | 'desc'` — default `'desc'`

**`listJobs`** — paginated list of jobs. Returns `Page<Job<...>>`. Blockers are not populated — use `getJobBlockers` to fetch them for a specific job. Filters:

- `typeName?: TJobTypeName[]` — job type names
- `id?: TJobId[]` — filter by job IDs
- `jobChainId?: TJobId[]` — filter by chain IDs
- `status?: JobStatus[]` — filter by job status
- `from?: DateBound` — lower bound on `createdAt`
- `to?: DateBound` — upper bound on `createdAt`
- `orderBy?: 'created'` — default `'created'`
- `orderDirection?: 'asc' | 'desc'` — default `'desc'`

**`listJobChainJobs`** — paginated jobs within a specific chain, ordered by `chainIndex`. Returns `Page<Job<...>>`. Takes `jobChainId`. Blockers are not populated.

- `orderBy?: 'chainIndex'` — default `'chainIndex'`
- `orderDirection?: 'asc' | 'desc'` — default `'asc'`

#### Blocker queries

**`getJobBlockers`** — blocker chains for a specific job. Takes `jobId` and an optional `typeName` for type narrowing. Returns `JobChain<...>[]`. Not paginated — blockers are declared at job creation and bounded by design.

**`listBlockedJobs`** — paginated list of jobs from other chains that are blocked by a given chain. Takes `jobChainId` and an optional `typeName` (chain type) for type narrowing — narrows the return to job types that declare this chain type as a blocker. Returns `Page<Job<...>>`. Useful for understanding downstream impact before deletion or for monitoring dependency graphs.

### Awaiting

**`awaitJobChain`** — wait for a chain to complete. Takes `typeName`, `id`, `timeoutMs`, optional `pollIntervalMs` and `signal`. Returns `CompletedJobChain<...>`. Combines polling with notify adapter events — between polls, it listens for completion notifications to react immediately. Throws on timeout or abort.

## Internal Hooks

The client and worker register hooks on `TransactionHooks` internally. These are not part of the public `TransactionHooks` API.

- **Notify hooks** — buffer notification calls (`notifyJobScheduled`, `notifyJobChainCompleted`, `notifyJobOwnershipLost`) and flush them after commit
- **Observability hook** — buffer metric emissions, log calls, and span completions until after commit

## See Also

- [Transaction Hooks](transaction-hooks.md) — TransactionHooks mechanism for buffering side effects
- [Job Chain Model](job-chain-model.md) — Chain structure, Promise analogy, terminology
- [Job Processing](job-processing.md) — Prepare/complete pattern, transactional design
- [Workerless Completion](workerless-completion.md) — Completing jobs without a worker
- [In-Process Worker](in-process-worker.md) — Worker lifecycle, leasing, reaper
- [Deduplication](deduplication.md) — Chain-level deduplication
