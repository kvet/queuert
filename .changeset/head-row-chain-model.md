---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

// TODO!!!: a part of job_model_v2

The head job row is now the chain itself. Chain facts — type name, deduplication key, trace context and completion time — live on that one row instead of being copied onto every continuation, and the state adapter returns them as an explicit chain object rather than smuggling them inside each job. Custom state adapters must be updated: every method that returns a job now returns it paired with its chain, chain listing and counting are anchored on the head row instead of the tail, and adding blockers validates the blocker chains itself now that the foreign key backing that check is gone. Chain completion is recorded when the chain ends rather than inferred from the last job, which makes completed-chain queries an index scan instead of a join, and removes a lock that made a blocker's foreign key wait on job acquisition for the length of a handler.

- `StateJob` drops `chainTypeName`, `deduplicationKey` and `chainTraceContext`; the new `StateChain` carries them, plus the chain's own `completedAt`.
- Adapter reads and writes return `StateChainView` (`{ chain, head, tail }`, where `tail` is `undefined` for a single-job chain) and `StateJobView` (`{ chain, job }`) in place of bare jobs and `[head, tail]` tuples.
- `startJobAttempt` returns `hasBlockers` and `completeJobs` returns `hasBlocking`, so the blocker lookup and the unblock pass only run when there is something to find.
- `lock: "exclusive"` on `getJobs` now takes its write-intent lock on the job **and** its chain's head row, since completing a job writes that head row. Custom adapters must widen the lock and take it in a consistent id order.
- `continueJobs` and `completeJobs` take one `completedBy` for the whole call instead of one per job, and `continueJobs` no longer accepts `chainTraceContext` — only `createJobs` creates a chain.
- `addJobsBlockers` throws `ChainNotFoundError` for an unknown blocker chain — a blocker chain id must name a head job — and reports each blocker with the chain it points at; `unblockJobs` returns blocker rows instead of a bare list of trace contexts.
- Schema: `chain_type_name` is removed, `chain_completed_at` is added, `job_continuation_idx` is dropped, `deduplication_key` and `chain_trace_context` are written on head rows only, both self-referential foreign keys on the job table and the blocker's chain foreign key are dropped, chain listing indexes are head-anchored, and the columns are reordered so fixed-width values stop paying alignment padding around the JSON payloads.
