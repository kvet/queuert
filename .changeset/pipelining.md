---
"@queuert/postgres": major
"@queuert/mysql": major
"@queuert/sqlite": major
---

PostgreSQL and MySQL state providers replace `executeSql` with a batched `executeStatements`, so the PostgreSQL and MySQL/MariaDB adapters can send the statements of one method together and a provider whose driver pipelines (`pg` with `pipeline: true`, postgres.js, Bun SQL on PostgreSQL, the `mariadb` connector) runs them in one round trip. A provider that runs the batch statement by statement stays correct, so moving a provider over is a loop around what `executeSql` did. SQLite runs in process and has no round trip to save, so its providers keep a single-statement method under the new name `executeStatement`.

- `PgStateProvider` and `MysqlStateProvider` take `executeStatements({ txCtx, statements })` and return one row array per statement; `executeSql` is removed.
- `SqliteStateProvider` renames `executeSql` to `executeStatement`, with the same options and result.
- A failing batch rejects with the first failing statement's driver error, so `classifyError` sees the real cause.
- A MySQL provider that pipelines opens its transactions with `SET autocommit = 0` rather than `START TRANSACTION`.
- The PostgreSQL adapter unblocks jobs in one round trip and deletes chains in two.
- The MySQL/MariaDB adapter completes and continues jobs, creates jobs and starts or stops workers in one round trip, starts attempts, adds blockers and unblocks jobs in two, and deletes chains in three or four.
