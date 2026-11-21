---
"queuert": major
"@queuert/postgres": minor
"@queuert/sqlite": minor
"@queuert/mysql": minor
"@queuert/redis": minor
---

Client reads can lock what they return, so a transaction can read a job or chain, check it and then write without a worker or another caller changing it in between. A custom state adapter must implement the new `getChainTails` method.

- `getJob`, `getJobs`, `getChain`, `getChains`, `getChainTailJob` and `getChainTailJobs` accept `lock: "exclusive"` in a transaction, locking the rows they return until it ends, and a locked tail read that waits on a worker continuing the chain returns the continuation.
- `getChainTailJob` and `getChainTailJobs` are no longer experimental.
- State adapters: a new `getChainTails` method reads each chain's tail job and, with `lock`, locks its head and tail.
- `createStateAdapterConformanceCases` adds `getChainTails` cases and lock-wait cases for `getChainTails` and `completeJobs`; `createStateAdapterEndToEndConformanceCases` adds locked-read cases.
