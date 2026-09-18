---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

// TODO!!!: a part of job_model_v2

The head job row is now the chain itself. Chain facts — type name, deduplication key, trace context and completion time — live on that one row instead of being copied onto every continuation, and the state adapter returns them as an explicit chain object rather than smuggling them inside each job. Custom state adapters must be updated: every method that returns a job now returns it paired with its chain, chain listing and counting are anchored on the head row instead of the tail, and adding blockers validates the blocker chains itself now that the foreign key backing that check is gone. Chain completion is recorded when the chain ends rather than inferred from the last job, which makes completed-chain queries an index scan instead of a join, and removes a lock that made a blocker's foreign key wait on job acquisition for the length of a handler.

- `StateJob` drops `chainTypeName`, `deduplicationKey` and `chainTraceContext` and carries its stored `status` (`StateJobStatus`: `blocked` / `pending` / `running` / `completed`); the new `StateChain` carries the chain columns plus the chain's own `status` (`StateChainStatus`: `running` / `completed`) and `completedAt`.
- Adapter reads and writes return `StateChainView` (`{ chain, head, tail }`, where `tail` is `undefined` for a single-job chain) and `StateJobView` (`{ chain, job }`) in place of bare jobs and `[head, tail]` tuples.
- `startJobAttempt` returns `hasBlockers` and `completeJobs` returns `hasBlocking`, so the blocker lookup and the unblock pass only run when there is something to find.
- `lock: "exclusive"` on `getJobs` now takes its write-intent lock on the job **and** its chain's head row, since completing a job writes that head row. Custom adapters must widen the lock and take it in a consistent id order.
- `continueJobs` and `completeJobs` take one `completedBy` for the whole call instead of one per job, and `continueJobs` no longer accepts `chainTraceContext` — only `createJobs` creates a chain.
- `addJobsBlockers` validates blocker chains itself — a blocker chain id must name a head job — and reports each blocker with the chain it points at; `unblockJobs` returns blocker rows instead of a bare list of trace contexts.
- Adapters no longer throw Queuert's domain errors: a row that is absent or already used up comes back as `undefined` in the result position it belongs to, and core turns that into the error you see, so the errors the public API throws are unchanged. `completeJobs` and `continueJobs` report an id that matches no job or one already completed, `addJobsBlockers` a `blockedByChainIds` entry that names no chain head, `extendJobAttempt` a job whose attempt this worker does not hold. Requests that are impossible rather than absent — a colliding caller-supplied id, a chain position another continuation took — still throw, and a batch that reports a hole may have written the entries that did resolve, so a caller treating a hole as an error must let it abort the transaction.
- Schema: `chain_type_name` is removed, `chain_status` and `chain_completed_at` are added, `job_continuation_idx` is dropped, `chain_status`, `deduplication_key` and `chain_trace_context` are written on head rows only, both self-referential foreign keys on the job table and the blocker's chain foreign key are dropped, chain listing indexes are head-anchored, and the columns are reordered so fixed-width values stop paying alignment padding around the JSON payloads.
