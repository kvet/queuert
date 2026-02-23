# Client

## Overview

The client is the public API for managing job chains. Created via `createClient()`.

## Methods

The client has two categories of methods: mutating and read-only.

**Mutating** — `startJobChain`, `completeJobChain`, `deleteJobChains`. These require a transaction context and `commitHooks` (see [Commit Hooks](commit-hooks.md)). Side effects (notifications, observability) are buffered via hooks and only flushed after the caller's transaction commits.

**Read-only** — `getJobChain`, `waitForJobChainCompletion`. These do not require `commitHooks`. `waitForJobChainCompletion` manages its own reads internally and does not require a transaction context either.

### Workerless Completion

`completeJobChain` allows completing jobs from outside the worker. The caller receives the current job and a `complete` function, which can optionally call `continueWith` to extend the chain. This is the same prepare/complete pattern used by the worker (see [Job Processing](job-processing.md)), but driven by the caller instead.

### Waiting

`waitForJobChainCompletion` combines polling with notify adapter events. Between polls, it listens for completion notifications to react immediately. Throws `WaitChainTimeoutError` on timeout or abort.

## Internal Hooks

The client and worker register hooks on `CommitHooks` internally. These are not part of the public `CommitHooks` API.

- **Notify hooks** — buffer notification calls (`notifyJobScheduled`, `notifyJobChainCompleted`, `notifyJobOwnershipLost`) and flush them after commit
- **Observability hook** — buffer metric emissions, log calls, and span completions until after commit

## See Also

- [Commit Hooks](commit-hooks.md) — CommitHooks mechanism for buffering side effects
- [Job Chain Model](job-chain-model.md) — Chain structure, Promise analogy, terminology
- [Job Processing](job-processing.md) — Prepare/complete pattern, transactional design
- [Workerless Completion](workerless-completion.md) — Completing jobs without a worker
- [In-Process Worker](in-process-worker.md) — Worker lifecycle, leasing, reaper
- [Deduplication](deduplication.md) — Chain-level deduplication
