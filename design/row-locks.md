# Row locks

Problems only — no direction yet. The PostgreSQL and MySQL/MariaDB adapters lock job rows and chain heads in orders that differ between code paths, and one path locks rows whose pending jobs nothing wakes. SQLite takes the write lock for the whole transaction, the in-process adapter serializes transactions, and Redis never waits on a lock, so none of these apply to them.

## Job creation against `deleteChains`

Creation locks blocker chain heads by id (`getChains({ lock: "exclusive" })`), while `deleteChains` and completion lock blocker-first by height. A create and a delete that reference the same two blocker heads deadlock when the lower id has the higher height. Creation and completion can collide the same way with ids that are not time-ordered.

`applyJobOutcomes` with `continueWith` locks the blocker heads after the job rows, so two calls that continue each other's chains as blockers can deadlock too.

## Locked reads against completion

A locked client read (`getChain`, `getJob`, `getChainTailJob` with `lock: "exclusive"`) and `applyJobOutcome` lock the chain head before the job row. `completeJobs` locks the job row and then writes the head. A client that reads with a lock and then writes deadlocks with a worker completing the same continued job, and the database aborts one side.

A head-first `completeJobs` was dropped unmeasured. On PostgreSQL it was a leading `FOR UPDATE ... ORDER BY id` pass over the heads, the shape `.claude/agents/publish-review/accepted.md` rejected for `completeJobs` (p50 ~2ms → ~250ms in the query-performance benchmark). On MySQL it was an unlocked chain-id pre-read, which reads from the transaction's snapshot at REPEATABLE READ and share-locks the job row before the head at SERIALIZABLE.

MySQL also locks chain by chain (head A, job A, head B, job B) where PostgreSQL locks every head first, so a multi-chain locked read on MySQL can deadlock where PostgreSQL waits.

## Blocker heads `deleteChains` locks

`lockDeletedChains` also locks the head of every blocker chain the deleted chains' jobs wait on. A worker can skip a pending blocker head while the delete runs, and nothing wakes it when the transaction ends: the client wakes only the deleted or refused chains' own jobs, so the blocker head waits for the next poll, up to `pollIntervalMs`.
