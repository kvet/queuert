---
"@queuert/postgres": patch
"@queuert/sqlite": patch
---

A `createChain` or `createChains` call that matches an existing multi-step chain through deduplication returns that chain's real output. Before, the PostgreSQL and SQLite adapters left the tail out of a deduplicated match, so a match against a completed chain that had continued reported the head job's empty output.

- `createJobs` on the PostgreSQL and SQLite state adapters returns the latest continuation as `tail` for a deduplicated match, as `getChains` does.
