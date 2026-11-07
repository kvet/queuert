---
"@queuert/sqlite": patch
---

The SQLite adapter takes SQLite's write lock for chain, job and worker locks inside a transaction with one no-op write to the empty `{prefix}write_lock` table, the same way migration transactions do. The lock no longer looks up or rewrites the locked rows.

- `getChains`, `getJobs` and `getWorkers` with `lock: "exclusive"` make that one no-op write before their read.
