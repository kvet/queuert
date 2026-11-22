---
"queuert": patch
"@queuert/sqlite": patch
"@queuert/mysql": patch
"@queuert/redis": patch
---

State adapter calls that carry many items no longer slow down with the batch size, which speeds up bulk enqueues, `applyJobOutcomes` and completing jobs with many outputs, deleting many chains, and the dashboard's worker counts.

- SQLite completes many jobs in one write in time linear in their number, and looks up every deduplication key of a `createJobs` call in one query.
- MySQL and MariaDB continue many jobs without re-reading the batch per job, and MariaDB looks deduplication keys up through their index.
- SQLite, MySQL, MariaDB and the in-process adapter count workers by type name in one pass over the workers instead of one per requested type.
- Redis deletes many chains in a fixed number of round trips instead of several per chain.
