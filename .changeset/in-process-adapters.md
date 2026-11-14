---
"queuert": major
---

The in-process state and notify adapters gain a synchronous mode and now default to it. They keep state only in memory and reach only the current process, so they suit tests, scripts and single-process apps that need no persistence; like the Redis state adapter, they do not commit with your application data. Their transaction context is now opaque.

- `createInProcessStateAdapter` and `createInProcessNotifyAdapter` return the adapter directly instead of a promise, and take a `mode` option, `"sync"` by default: their methods return results directly, and `withTransaction` requires a synchronous callback. Pass `mode: "async"` for promise-returning adapters as before. `InProcessStateAdapter` takes the matching mode parameter, also `"sync"` by default.
- Inside a synchronous transaction, a call to the in-process state adapter without that transaction's context, including a nested `withTransaction`, throws instead of running outside it.
- The in-process state adapter keeps indexes for its list, count and type-name queries, so they no longer scan every job, and it creates and completes jobs faster.
- Removed from `queuert`: `InProcessContext`. Pass the context `withTransaction` gives you without naming its type.
