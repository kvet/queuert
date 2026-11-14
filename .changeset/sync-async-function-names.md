---
"queuert": patch
"@queuert/postgres": patch
"@queuert/mysql": patch
"@queuert/sqlite": patch
"@queuert/redis": patch
---

Functions that run in both synchronous and asynchronous mode now carry their real names in stack traces and CPU profiles, and a synchronous client or in-process state adapter given a callback that returns a promise reports it with one shared error message.

- Compiled functions are named after the variable or property they belong to, such as `createChainSync` and `createChainAsync`, instead of `sync` and `async`.
- A promise returned to a synchronous `completeChain` handler, `completeJob` callback or in-process `withTransaction` callback throws "A synchronous step got a promise: the value must be synchronous".
