---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/mysql": major
"@queuert/redis": major
---

Workers no longer miss a pending job that another transaction held locked while they looked for work. Attaching a dependent to a blocker chain, the locked client reads, `applyJobOutcome` / `applyJobOutcomes` and `deleteChains` lock jobs they read, and a worker polling at that moment skipped a locked pending job and then waited for its next poll, up to `pollIntervalMs`. The client now wakes workers for those jobs when the transaction ends, or right away when a savepoint or `retryBoundary` try that locked them rolls back, so they pick them up without waiting, except for the jobs the transaction itself completed, continued, rescheduled or deleted. To tell which transaction a context belongs to, state adapters and state providers replace `isTransaction` with `getTransaction`.

- Creating a chain with blockers, or continuing with blockers, wakes workers for each blocker chain whose head job was pending, on commit and on rollback.
- `getChain(s)`, `getJob(s)` and `getChainTailJob(s)` with `lock: "exclusive"` wake workers for the pending jobs they locked on rollback, and on commit for those the transaction left pending.
- `applyJobOutcome` / `applyJobOutcomes` wake workers for the pending jobs they locked when the transaction rolls back, or when it commits without the outcome, such as after the call failed or its savepoint rolled back.
- `deleteChains` wakes workers for the pending jobs of the chains it deleted when the transaction rolls back, and for those of the chains it refused to delete on commit and on rollback.
- A transaction sends its notify events once when it ends, each job type, chain and job at most once per kind, however many calls in it scheduled, completed or locked them; over a sync notify adapter too, which sent them call by call.
- State adapters and the PostgreSQL, SQLite and MySQL state providers replace `isTransaction(txCtx)` with `getTransaction(txCtx)`, which returns the object identifying the open transaction a context belongs to, or `undefined` outside one and once it has ended, so mutating client methods reject a context whose transaction has ended.
- Every context of one transaction, savepoints and `retryBoundary` tries included, gets the same object from `getTransaction`; a provider that carries `txHooks` in its context returns them while `txHooks.isOpen`.
- `TxHooks` gains `isOpen`, `true` until the hooks are flushed or discarded.
- `createStateAdapterConformanceCases` checks `getTransaction` in place of `isTransaction`, including that it returns `undefined` once the transaction has ended; `createStateAdapterEndToEndConformanceCases` with `concurrent: true` adds cases that a worker starts a locked pending job as soon as the transaction holding it commits or rolls back, and every end-to-end suite adds cases that a commit does not wake workers for jobs the transaction completed, continued, rescheduled or deleted.
