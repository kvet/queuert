---
"queuert": major
---

Attempt handlers take a simpler shape: whether an attempt completed has always been decided by the committed `applyJobOutcome` call, and the handler's types now say so.

- The attempt handler's `complete` is renamed `applyJobOutcome`, the name of the client method that applies the same outcomes; it takes the same transaction context and outcomes, and returns the same job.
- The abort signal is `job.signal` in place of the handler's `signal` option, and attempt middleware's `wrapHandler` sees it on its `job` too.
- `fence` is renamed `fenceJob`, which locks the job and checks that the attempt still owns it.
- Attempt handlers return `Promise<void>`: await the transaction that calls `applyJobOutcome` instead of returning its result; a job without a committed outcome when the handler ends fails as before.
- Attempt middleware's `wrapHandler` and its `next` resolve to `void` instead of passing the handler's result through.
