---
"queuert": major
---

The in-process state and notify adapters stay public and gain synchronous variants. They keep state only in memory and reach only the current process, so they suit tests, scripts and single-process apps that need no persistence; like the Redis state adapter, they do not commit with your application data. Their transaction context is now opaque.

- New in `queuert`: `createSyncInProcessStateAdapter`, `SyncInProcessStateAdapter` and `createSyncInProcessNotifyAdapter`.
- The in-process state adapter keeps indexes for its list, count and type-name queries, so they no longer scan every job, and it creates and completes jobs faster.
- Removed from `queuert`: `InProcessContext`. Pass the context `withTransaction` gives you without naming its type.
- The logging, validation, codec and OpenTelemetry examples keep their state in an in-memory SQLite database.
