---
"queuert": major
---

A client created without `notifyAdapter` wakes its own worker runners and `awaitChain` calls through an in-process notify adapter, so a single-process app gets immediate pickup without configuring one. Worker runners in other processes, or built from another client, still poll; pass a shared notify adapter (PostgreSQL, Redis, NATS) for those.

- `createClient` without `notifyAdapter` uses an in-process notify adapter scoped to that client instead of polling only.
- Removed from `queuert`: `createInProcessNotifyAdapter`. Drop the option and its `close()` call; the default behaves the same within one client. Several clients in one process that shared one in-process adapter each get their own, so pass a shared notify adapter to keep them waking each other.
