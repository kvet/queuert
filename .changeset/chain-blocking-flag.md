---
"queuert": major
"@queuert/postgres": major
"@queuert/mysql": major
"@queuert/sqlite": major
"@queuert/redis": major
"@queuert/dashboard": minor
---

Every state adapter now records on each chain whether a job waits on it, as a `blocking` flag that is true while at least one blocker references the chain and false once the last one is gone. Completing a chain nothing waits on skips the unblock step. The `listChains` filter `independent` becomes `blocking` with the opposite meaning, so `independent: true` is now `blocking: false`. The flag ships in the breaking `002_schema_v2` migration on PostgreSQL, SQLite, MySQL/MariaDB and Redis, which replaces write fence version 1 with version 2: 0.18 processes fail their writes with `SchemaFencedError` from the swap on, so stop them once the new version is deployed. Databases still on 0.17 must be migrated with 0.18 first.

- `StateChainInfo` gains `blocking`; custom state adapters set it when `addJobsBlockers` references a chain, clear it when `deleteChains` removes the last blocker row that references it, and report it on every chain they return.
- `client.listChains` and the state adapter `listChains` take `blocking` instead of `independent`.
- Migration `002_schema_v2` adds `blocking` to chain heads, sets it on every chain a blocker references, and adds the `chain_blocking_idx` index (the `blocking-chains:*` sorted sets on Redis).
- On PostgreSQL, `002_schema_v2` copies the job table into a new one in batches while 0.18 keeps running, then swaps them in one short locked step; the new table keeps the old one's privileges, but policies, publications, triggers or indexes you added to it must be re-created; on SQLite, MySQL/MariaDB and Redis it adds `blocking` to the existing tables or records and backfills it, with 0.18 fenced before the backfill.
- `migrateToLatest` no longer upgrades a database left by 0.17.
- The MySQL/MariaDB adapter completes jobs and deletes chains with fewer statements.
- The dashboard chain list's role filter offers Blocking and Not blocking, with a `blocking` URL parameter in place of `independent`.
