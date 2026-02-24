# Client

## Overview

The client is the public API for managing job chains. Created via `createClient()`.

## Methods

The client has two categories of methods: mutating and read-only.

**Mutating** — `startJobChain`, `completeJobChain`, `deleteJobChains`. Require `transactionHooks` and a transaction context. Side effects (notifications, observability) are buffered via hooks and only flushed after the caller's transaction commits.

**Read-only** — `getJobChain`, `getJob`, `listJobChains`, `listJobs`, `getBlockerJobChains`, `getBlockedJobs`, `awaitJobChain`. Do not require `transactionHooks`. Accept an optional transaction context — when omitted, the adapter acquires its own connection.

All methods accept a transaction context: required for mutations (rollback safety for side effects), optional for queries (standalone reads are fine).

### Mutation Methods

All mutation methods require `transactionHooks` and a transaction context. Side effects are buffered and flushed after the caller's transaction commits.

**`startJobChain`** — create a new job chain. Takes `typeName`, typed `input`, optional `blockers`, `deduplication`, and `schedule`. Returns the created `JobChain<...>` with a `deduplicated` flag. The return type narrows to the specified chain type.

**`completeJobChain`** — complete a chain from outside a worker. Takes `typeName`, `id`, and a `complete` callback. The caller receives the current job and a `complete` function, which can optionally call `continueWith` to extend the chain. This is the same prepare/complete pattern used by the worker (see [Job Processing](job-processing.md)), but driven by the caller instead. See [Workerless Completion](workerless-completion.md).

**`deleteJobChains`** — delete chains by ID. Takes `ids` and optional `cascade`. Returns the deleted `JobChain<...>[]`. Throws if external jobs depend on them as blockers. When `cascade` is true, expands the set to include transitive dependencies before deleting. See [Deletion](deletion.md).

### Query Methods

**`getJobChain`** — get a single chain by ID. Returns `JobChain<...> | null`. Takes `typeName` and `id` — the return type narrows to the specified chain type.

**`getJob`** — get a single job by ID. Returns `Job<...> | null`. Takes `typeName` and `id` — the return type narrows to the specified job type.

**`listJobChains`** — paginated list of chains. Returns `Page<JobChain<...>>`. Accepts filters: `typeName` (chain type names), `rootOnly` (exclude chains referenced as blockers), `id` (search by chain ID or find chain containing a job ID). When the `typeName` filter is a single value, the return type narrows to that chain type's `JobChain`; otherwise it's a union of all entry types.

**`listJobs`** — paginated list of jobs. Returns `Page<Job<...>>`. Accepts filters: `status`, `typeName` (job type names), `jobChainId`, `id` (search by job ID or chain ID). Blockers are not populated — use `getBlockerJobChains` to fetch them for a specific job. When the `typeName` filter is a single value, the return type narrows to that job type.

**`getBlockerJobChains`** — blocker chains for a specific job. Takes `jobId` and an optional `typeName` for type narrowing. Returns `JobChain<...>[]`.

**`getBlockedJobs`** — jobs from other chains that are blocked by a given chain. Takes `jobChainId` and an optional `typeName` (chain type) for type narrowing — narrows the return to job types that declare this chain type as a blocker. Returns `Job<...>[]`. Useful for understanding downstream impact before deletion or for monitoring dependency graphs.

All query methods accept an optional transaction context. Both pagination methods use cursor-based pagination (`Page<T>` with `nextCursor`) consistent with the state adapter.

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
