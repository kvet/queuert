---
"queuert": major
"@queuert/dashboard": major
---

`Job` no longer carries `chainTypeName`. A job's own `typeName` and `chainId` identify it; the chain's type belongs to the chain, so read it from `getChain`/`listChains` (or `chain.typeName` inside `completeChain`) instead of off each job. The chain type name is still denormalized on the stored job row, so type-anchored listing queries are unaffected, and `listChainJobs({ chainTypeName })` keeps its filter.

- `Job` drops the `chainTypeName` field and its `TChainTypeName` type parameter, so `Job<TJobId, TJobTypeName, TInput, TOutput, TCanContinue>` now takes five arguments.
- The exported generics that threaded that parameter through lose it too: `ResolvedJob`, `ResolvedJobWithBlockers`, `ContinuationJob`, `ContinuationJobs`, `OutputJob`, `RescheduledJob`, `ContinuedJob`, `AttemptFinishResult`, `AttemptFinish`, `AttemptCompleteOptions`, `AttemptCompleteCallback`, `AttemptComplete`, and `AttemptHandler`. Explicit type arguments must drop the chain type name; inferred usage (processors, middleware, handlers) needs no change.
- Attempt handlers that logged or branched on `job.chainTypeName` should use `job.chainId` or fetch the chain.
- The dashboard's `GET /api/jobs/{jobId}` response gains a `chain` field carrying the job's owning chain, which the job detail view now uses for the chain label.
