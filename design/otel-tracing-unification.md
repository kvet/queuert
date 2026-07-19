# OTEL Tracing Unification

## Problem

The `ObservabilityAdapter` tracing API has two code paths for job completion that produce asymmetric trace trees:

**Worker path** — the primary path. `startAttemptSpan` creates a CONSUMER span; the attempt handler runs inside it; `attemptSpan.end()` finishes it and, when the chain completes, nests a `complete chain` CONSUMER span as a child:

```
PRODUCER: create job.X
└── CONSUMER: start job-attempt.X
    ├── INTERNAL: prepare
    ├── INTERNAL: complete
    └── CONSUMER: complete chain.Y    ← nested under the attempt
```

**Workerless path** — used by `completeChain`. There is no attempt span. Instead, `completeJobSpan` creates an ad-hoc CONSUMER span (`complete job.X`) as a stand-in, and nests the chain consumer span under it:

```
PRODUCER: create job.X
└── CONSUMER: complete job.X          ← ad-hoc, no attempt
    └── CONSUMER: complete chain.Y
```

The asymmetry exists because workerless completion doesn't use `startAttemptSpan`. The `completeJobSpan` adapter method exists solely to compensate for the missing attempt span in the workerless path.

## Prior exploration

An attempt was made to split `startJobSpan` (which used an `isChainStart` boolean flag) into separate `startChainSpan` and `startJobSpan` methods on the adapter, mirroring the state adapter's `createChains`/`createContinuationJob` split. During that work, `completeJobSpan` was also split into `completeJobSpan`/`completeChainSpan`. This surfaced the deeper issue: the split doesn't resolve the asymmetry — `completeJobSpan` itself is the workaround. The real fix is making the workerless path produce the same span structure as the worker path.

The `startChainSpan`/`startJobSpan` split (composable, no `isChainStart` flag) was a clean improvement on its own but was reverted along with the complete-side changes to keep the scope focused. It should be re-applied as step 1 of the fix below.

## Proposed solution

Treat workerless completion as an attempt. The workerless path (`finishJob` with `workerId === null`) should call `startAttemptSpan` / `attemptSpan.end()` just like the worker path, producing the same trace tree shape. This eliminates `completeJobSpan` from the adapter entirely.

### Steps

1. **Split `startJobSpan`** into composable `startChainSpan` (chain PRODUCER) + `startJobSpan` (job PRODUCER, takes `chainTraceContext`). Remove the `isChainStart` flag from `finalizeCreatedJobs` (use presence of `chainSpanHandles` instead). Also remove `isChainStart` from `JobSpanInputData` and the OTEL adapter's `startJobSpan` implementation. This cleans up the creation-side API to match the state adapter's `createChains`/`createContinuationJob` split.

2. **Add attempt span to workerless path** — in `finishJob` (or the `completeChain` client method), call `startAttemptSpan` before the user callback and `attemptSpan.end()` after, mirroring the worker's `job-process.ts` flow. The attempt span carries `workerId: null` to distinguish it from worker attempts.

3. **Remove `completeJobSpan`** from the adapter, helper, noop, and OTEL implementation. The adapter's complete-side tracing reduces to just `startAttemptSpan` (which already handles `chainCompleted` internally).

### Resulting trace tree

Both paths produce the same shape:

```
PRODUCER: create chain.Y
└── PRODUCER: create job.X
    └── CONSUMER: start job-attempt.X
        ├── INTERNAL: prepare        (worker path only)
        ├── INTERNAL: complete       (worker path only)
        └── CONSUMER: complete chain.Y
```

The workerless attempt span may omit `prepare`/`complete` sub-spans since there is no staged prepare/complete flow — the user callback runs directly.

### Open questions

- Should the workerless attempt span use the same `start job-attempt.{typeName}` name, or a distinct name like `complete job.{typeName}`?
- Should `prepare`/`complete` sub-spans be emitted for workerless completion (the `completeChain` callback is conceptually a "complete" phase)?
