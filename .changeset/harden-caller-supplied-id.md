---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
---

Caller-supplied `id` on `createChain`/`createChains`/`continueWith` is now assignment-only with a hard error on collision. Previously, PostgreSQL and SQLite silently returned the existing row (with `deduplicated: false`), and the in-process adapter silently overwrote it. Now all three adapters reject a duplicate `id` — SQL adapters surface the raw constraint violation, in-process throws before writing. Deduplication is unaffected and stays exclusively with the `deduplication` option.

- A caller-supplied `id` that collides with an existing job now errors instead of being silently swallowed.
- Intra-batch duplicate `id` values in a single `createChains` call error (raw database constraint on SQL adapters).
- Generated id collisions from a misconfigured `generateId` also error — `generateId` must return unique values.
- `id` remains optional; when omitted, `generateId()` produces the id as before.
