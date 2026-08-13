---
"queuert": major
"@queuert/otel": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

Rework the attempt's `complete` phase into a callback that decides the outcome via `finish`. The outcome is a plain object — `{ output }` or `{ continueWith: { typeName, input, ... } }`. `finish` writes before it returns, so code after it observes the committed state within the same transaction.

- Migrate `complete(async () => output)` → `complete(async ({ finish }) => finish({ output }))`.
- Migrate `complete(async ({ continueWith }) => continueWith(x))` → `complete(async ({ finish }) => finish({ continueWith: x }))`.
- `finish({ output })` returns the completed job; `finish({ continueWith })` returns the completed job with the new job on `continuedTo`.
- `client.completeChain`'s `complete` option is renamed `handler`, and the function it receives is renamed `completeJob` to distinguish it from the worker's `complete` (which finishes the current job and takes no job argument). `completeJob(job, callback)` uses the same `finish` vocabulary and unwraps whatever the callback returns: return the `finish({ continueWith })` result and you get the continuation back, so a handler can walk several jobs with `job = await completeJob(job, ...)`; a `finish({ output })` result resolves to the completed job.
- The `prepare`, `step` and `complete` spans now record the exception and report `ERROR` status when the phase throws, and the `complete` span is no longer left unended when it does.
