---
"@queuert/postgres": major
"@queuert/sqlite": major
---

Remove the one-step upgrade from a v0.15.1 database. `migrateToLatest()` no longer converts v0.15.1 job tables to the current schema, so a v0.15.1 database must first be upgraded with `@queuert/postgres` / `@queuert/sqlite` 0.16.x before moving to this version.
