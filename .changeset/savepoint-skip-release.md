---
"@queuert/postgres": patch
"@queuert/sqlite": patch
---

Drop the `RELEASE SAVEPOINT` round-trip from the built-in savepoint fallback used by the PostgreSQL and SQLite state adapters. A successful savepoint is now simply left open — the surrounding `COMMIT` discards outstanding savepoints anyway — which removes one statement per `prepare` and per `complete` phase of every job attempt. Rollback behaviour is unchanged, and savepoint names stay unique per call so nested savepoints still roll back independently.
