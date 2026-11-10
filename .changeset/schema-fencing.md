---
"queuert": minor
"@queuert/postgres": major
"@queuert/sqlite": major
---

Code running against a newer schema can no longer corrupt state. The schema now carries an empty write fence table that every insert or update of a job, blocker or worker references. A later breaking migration drops it, so writes from older processes fail with `SchemaFencedError` and change nothing. The migration history of `@queuert/postgres` and `@queuert/sqlite` is squashed into a single `001_initial_schema` at schema version 1. `migrateToLatest()` carries a 0.17 database onto it by adding the fence table and dropping the `002_worker_liveness` record, without touching job or worker rows, so 0.17 workers can keep running during the upgrade. 0.17 references no fence, so stop every 0.17 process before the first breaking migration.

- New `SchemaFencedError`, thrown by every PostgreSQL and SQLite state adapter write once the schema fenced its code version; worker runners report it through `workerError`.
- The schema adds a `{prefix}schema_fence_v1` table on PostgreSQL and SQLite.
- `001_initial_schema` now builds the whole schema, and `002_worker_liveness` is gone. A 0.16 database is refused: upgrade it with 0.17 first.
- `PgStateProvider` and `SqliteStateProvider` require `classifyError({ error })`, returning `{ kind: "undefined_table", tableName }` with the missing table's name for a missing-table error, and `undefined` otherwise or when the name cannot be read. Custom providers must implement it; `pgStateProviderConformanceCases` and `sqliteStateProviderConformanceCases` check it, along with the fence itself.
