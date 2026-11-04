---
"@queuert/postgres": patch
---

Paging through `listJobs` and `listBlockedJobs` on PostgreSQL no longer repeats or skips jobs that share a timestamp down to the millisecond, such as jobs created in one transaction. The next-page cursor now keeps the full microsecond precision PostgreSQL stores, so the dashboard's job lists and the client's `listJobs` / `listBlockedJobs` page through every job exactly once.
