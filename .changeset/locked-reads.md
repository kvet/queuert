---
"queuert": minor
---

Add an opt-in `lock: true` to the read methods `getChain`, `getChains`, `getJob`, and `getJobs`. When set, the matched rows are held under a write-intent lock until the enclosing transaction ends (PostgreSQL `SELECT ... FOR UPDATE`, SQLite write-lock promotion, in-process transaction serialization), making a read-modify-write against a chain or job race-free. Because the lock only lasts for a transaction, `lock: true` requires a transaction context — the options are a discriminated union so `{ lock: true }` without one fails to compile. A lookup that matches nothing locks nothing, so `lock` guards updates and deletes of existing rows but not a create-if-absent race — pair it with `createChain` deduplication for that.
