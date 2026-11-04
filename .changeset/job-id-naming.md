---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

The state adapter options for job IDs now name the job explicitly, matching `InvalidJobIdError`.

- `generateId` and `validateId` are renamed to `generateJobId` and `validateJobId`, as options of `createPgStateAdapter`, `createSqliteStateAdapter` and `createInProcessStateAdapter`.
- The `idType` option of `createPgStateAdapter` and `createSqliteStateAdapter` is renamed to `jobIdType`.
