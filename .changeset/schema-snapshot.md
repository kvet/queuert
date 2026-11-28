---
"@queuert/postgres": patch
"@queuert/sqlite": patch
"@queuert/mysql": patch
"@queuert/redis": patch
---

`migrateToLatest()` on an empty database creates the latest schema in one step and records every schema migration as applied, so a new install skips the history, such as the job table copy of `002_schema_v2` on PostgreSQL. A database an earlier release created runs only the migrations it is missing, as before.
