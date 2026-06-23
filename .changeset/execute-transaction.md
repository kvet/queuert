---
"queuert": minor
---

Add `execute` as a third transaction primitive on the attempt handler alongside `prepare` and `complete`. Each call opens a fresh guarded transaction (lease ownership verified), runs the user callback with `txCtx` and `transactionHooks`, commits, and flushes hooks. Only valid in staged mode between `prepare` and `complete`. Includes `wrapExecute` middleware hook. Enables batched transactional work in long-running staged handlers without holding a single long-lived transaction.
