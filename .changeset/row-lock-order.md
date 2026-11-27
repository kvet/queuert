---
"queuert": major
"@queuert/postgres": minor
"@queuert/mysql": minor
"@queuert/sqlite": minor
"@queuert/redis": minor
---

Queuert takes row locks in one order: chain heads before any other job, and blockers before the chains that wait on them where the blockers are known up front. Client calls that lock the same chains wait on each other instead of deadlocking. `deleteChains` locks the chains and checks blocker references in the client, so the state adapter method only deletes.

- `deleteChains` refuses any chain with `blocking: true`, even when the jobs waiting on it belong to chains in the same call; delete the waiting chains first, in an earlier call in the same transaction.
- `BlockerReferenceError` carries `chainIds`, the chains that blocked the deletion, in place of `references`.
- On PostgreSQL and MySQL/MariaDB, `deleteChains` locks the chains it deletes and the chains they wait on blocker first, a blocker before the chains that wait on it, including a blocker a chain gains while the delete waits, so deleting chains while one of their blockers completes, or alongside other deletes on MariaDB, does not deadlock; a locked read of a blocker together with a chain that waits on it can still deadlock with a delete, and the database aborts one of the two transactions.
- `deleteChains` locks each chain's head and current tail, as `getChainTailJobs` with `lock: "exclusive"` does, before it checks and deletes.
- `applyJobOutcome(s)` locks the blocker chains named in `continueWith` before the jobs it applies outcomes to.
- `getJob(s)` with `lock: "exclusive"` locks the chain heads before the jobs on PostgreSQL and MySQL/MariaDB, and `getChainTailJob(s)` locks every head before any tail on MySQL/MariaDB.
- State adapters: `getChainTails` takes `lockBlockers`, which locks the chains and the chains they wait on blocker first; `deleteChains` expects the caller to hold those locks, returns `(StateChain | undefined)[]`, and no longer checks references from outside jobs.
