---
"@queuert/postgres": patch
"@queuert/sqlite": patch
"@queuert/redis": patch
---

`migrateToLatest()` on the PostgreSQL, SQLite and Redis state adapters checks the server version before it runs any migration, and throws a clear error on a version Queuert does not support, rather than failing later on a missing feature.

- PostgreSQL: requires 14 or later, read from `server_version_num`.
- SQLite: requires 3.42 or later, read from `sqlite_version()`, which reports the SQLite the driver bundles.
- Redis: requires 6 or later, read from the `redis_version` the server reports, so Valkey and other Redis-compatible servers pass on the version they report.
- The error reads `Unsupported <server> version <version>: Queuert needs <minimum> or later`.
