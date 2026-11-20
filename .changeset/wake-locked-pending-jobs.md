---
"queuert": patch
---

Workers no longer miss a pending job that another transaction held locked while they looked for work. Attaching a dependent to a blocker chain, `completeChain`, `rescheduleJob` / `rescheduleJobs` and `deleteChains` lock jobs they read, and a worker polling at that moment skipped a locked pending job and then waited for its next poll, up to `pollIntervalMs`. The client now wakes workers for those jobs when the transaction ends without having started or removed them, so they pick them up right away.

- Creating a chain with blockers, or continuing with blockers, wakes workers for each blocker chain whose head job was pending, on commit and on rollback.
- `completeChain` wakes workers for the current job when it was pending, on rollback, and on commit when the handler left it pending.
- `rescheduleJob` / `rescheduleJobs` wake workers for the pending jobs they locked when the transaction rolls back, or when it commits after the call failed.
- `deleteChains` wakes workers for the pending jobs of the chains it deleted when the transaction rolls back, and for those of the chains it refused to delete on commit and on rollback.
- `createStateAdapterEndToEndConformanceCases` with `concurrent: true` adds cases that a worker starts such a job as soon as the transaction holding it commits or rolls back.
