---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

Allow callers to assign job IDs and validate them adapter-side. `startChain`, `startChains`, and the worker `continueWith` callback now accept an optional `id` that becomes the new chain root (or continuation) job ID. State adapters accept a new `validateId` predicate that runs on both adapter-generated and caller-supplied IDs; failures throw the new `InvalidJobIdError`. When deduplication fires, the existing row's ID wins over a caller-supplied `id` (the returned chain carries `deduplicated: true`).

Adapter ID-generation options are now aligned: both PostgreSQL and SQLite adapters expose a `generateId` function (renamed from `idGenerator` on SQLite; replacing the SQL `idDefault` option on PostgreSQL). The PostgreSQL adapter switches from server-side default expressions to JS-side ID generation, and a new migration drops `DEFAULT gen_random_uuid()` from the `id` column. Existing UUID generation behavior is unchanged for default configurations.

- PostgreSQL: replace `idDefault: "gen_random_uuid()"` with `generateId: () => crypto.randomUUID()` (this is the default and can be omitted).
- PostgreSQL: replace `idDefault: "'job.' || gen_random_uuid()::text"` with `generateId: () => \`job.${crypto.randomUUID()}\``.
- SQLite: rename `idGenerator` option to `generateId`.
- Custom state adapter implementations must accept an optional `id` per entry in `createJobs` and apply their own `validateId` predicate.
