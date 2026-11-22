---
"queuert": major
"@queuert/postgres": minor
"@queuert/sqlite": minor
"@queuert/mysql": minor
"@queuert/redis": minor
---

State adapters read the blockers of many jobs in one call, so loading a batch's blockers costs one round trip instead of one per job. A custom state adapter must rename and widen one method; `client.getJobBlockers` is unchanged.

- State adapters: `getJobBlockers({ jobId })` is replaced by `getJobsBlockers({ jobIds })`, which returns each job's blocker chains in index order, one list per id in the order of `jobIds`, and an empty list for an unknown job.
- `createStateAdapterConformanceCases` renames its `getJobBlockers` cases to `getJobsBlockers` and adds cases for several, repeated and unknown ids.
