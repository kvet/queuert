---
"@queuert/postgres": patch
"@queuert/sqlite": patch
"@queuert/mysql": patch
---

The PostgreSQL, SQLite and MySQL state adapters no longer import `node:crypto`. They use the global `crypto` instead, so they load in any runtime that provides Web Crypto, including browsers and edge workers. The default job and worker ID type is still the UUID string `crypto.randomUUID()` returns.

- The adapters' declarations type the default IDs as `ReturnType<typeof crypto.randomUUID>` instead of importing `UUID` from `node:crypto`.
- The MySQL adapter generates attempt and worker tokens with `crypto.randomUUID()`.
