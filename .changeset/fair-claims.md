---
"queuert": patch
"@queuert/postgres": patch
"@queuert/mysql": patch
"@queuert/redis": patch
---

A worker runner with several job types claims the batches whose first job is oldest across its types on every state adapter, and a claim locks only the jobs it takes, so concurrent worker runners are no longer kept off jobs that another claim locked but left behind.

- PostgreSQL claimed whole runs of one randomly picked type, and MySQL claimed round-robin across types by name; both now take the oldest batches first, like the in-process, SQLite and Redis adapters.
- PostgreSQL and MySQL picked a claim's jobs from a larger set of locked rows, up to every type's full share; they now size each type's share with a read that takes no locks and lock only that share, so a claim racing another may return fewer batches and the worker runner claims the rest on its next wake-up.
- Redis locks the jobs a claim inside an open transaction takes, so a concurrent claim leaves them to it instead of taking them and making the transaction retry.
