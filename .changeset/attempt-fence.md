---
"queuert": minor
---

The attempt handler receives `fence`, which checks attempt ownership inside the other transactions a handler opens besides the one that calls `complete`, such as batch deletes or checkpoints. Call `fence({ ...txCtx })` at the start of such a transaction: it locks the job row and its chain head and throws, aborting `signal`, if the attempt no longer owns the job, so the transaction's writes commit only while the attempt owns the job. Reclaiming, completing or deleting the job waits for a fenced transaction to end, so keep fenced transactions short.

- `fence` throws `JobTakenByAnotherWorkerError`, `JobAlreadyCompletedError` or `JobNotFoundError`, the same errors as `complete`.
- `fence` writes nothing and can be called any number of times; in the transaction that calls `complete`, call it before `complete`.
