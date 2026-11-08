---
"queuert": patch
"@queuert/postgres": patch
"@queuert/sqlite": patch
---

Processing a job costs less CPU and allocates less memory: about 35–40% less CPU per job with the SQLite and PostgreSQL state adapters in the runtime performance benchmark.

- Tx hooks and the adapter logging wrappers allocate less per transaction and per adapter call, and flushing tx hooks adds no extra await unless a commit callback returns a promise.
- Notifications from transactions that commit at the same time are sent in one notify adapter call, with duplicate job types, chain ids and job ids removed.
- A waiting worker wakes up through a plain timer, without creating an `AbortController`, `AbortSignal.any` and an abort `DOMException` on every wait.
- With no `log` and no observability adapter configured, events are dropped before their payloads are built.
- The PostgreSQL and SQLite state adapters build each query's parameter and column type maps once instead of on every query.
- The SQLite state adapter claims jobs with a prepared statement that SQLite keeps, instead of one it re-parses and re-plans on every claim because of its bound `LIMIT`.
- The SQLite state adapter skips unblocking dependent jobs with a single indexed check when no job is blocked by the completed chain, as the PostgreSQL adapter already does.
