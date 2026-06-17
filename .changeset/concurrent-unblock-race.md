---
"@queuert/postgres": minor
"@queuert/sqlite": minor
---

A job can now reference the same blocker chain more than once. The `job_blocker` primary key is widened from `(job_id, blocked_by_chain_id)` to `(job_id, blocked_by_chain_id, index)` via a new migration so duplicate chain IDs at different positions are stored faithfully. The Postgres adapter also takes row-level locks on blocked jobs (ordered by id to prevent deadlocks) when evaluating concurrent blocker completions, preventing a race that could leave dependent jobs stranded in `blocked` status.
