---
"queuert": major
---

A client created without `notifyAdapter` wakes its own worker runners and `awaitChain` calls through an in-process notify adapter, so a single-process app gets immediate pickup without configuring one. Worker runners in other processes, or built from another client, still poll; pass a shared notify adapter (PostgreSQL, Redis, NATS) for those.

- `createClient` without `notifyAdapter` uses an in-process notify adapter scoped to that client instead of polling only.
