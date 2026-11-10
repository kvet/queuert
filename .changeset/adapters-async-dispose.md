---
"queuert": major
"@queuert/postgres": minor
"@queuert/sqlite": minor
"@queuert/redis": minor
"@queuert/nats": minor
---

State and notify adapters are async disposable: `[Symbol.asyncDispose]` calls `close()`, so an adapter can be held with `await using` and is closed when the scope ends. The `StateAdapter` and `NotifyAdapter` types require it, so a custom adapter must implement it, usually by pointing it at `close`.
