---
"queuert": major
---

The in-process state adapter is no longer part of the public API: it existed for Queuert's own tests, kept state only in memory and offered nothing a SQLite database in `:memory:` does not. For tests, scripts and single-process apps that need no persistence, use `createSqliteStateAdapter` from `@queuert/sqlite` with an in-memory database.

- Removed from `queuert`: `createInProcessStateAdapter`, `InProcessStateAdapter` and `InProcessContext`.
- The logging, validation, codec, OpenTelemetry and notify examples keep their state in an in-memory SQLite database.
