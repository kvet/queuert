---
"@queuert/postgres": major
"@queuert/sqlite": major
---

`PgStateAdapter` and `SqliteStateAdapter` no longer have `truncate()`. It only existed to clear the tables between tests; run `TRUNCATE` or `DELETE` against the job, blocker and worker tables yourself. The provider conformance contexts still clear the tables before every case.
