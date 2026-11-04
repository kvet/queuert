---
"@queuert/postgres": patch
"@queuert/sqlite": patch
---

Concurrent `migrateToLatest()` runs, such as several app instances deploying at once, now apply each migration exactly once (fixes [#7](https://github.com/kvet/queuert/issues/7)). On Postgres, a run whose migration lease was taken over (or taken over and released) by another process could silently re-claim it and re-run migrations that process had already applied, and a heartbeat still in flight at shutdown could leave a fresh lease behind that made other instances wait out its TTL. On SQLite, concurrent runs could each apply the same migration, and a second process migrating the same file failed with `database is locked`.

- Postgres: the lease is fenced by owner id; a run that loses it aborts before its next migration step and never re-claims it.
- Postgres: heartbeats run one at a time, and the lease is released only after any in-flight heartbeat settles.
- Postgres: every migration transaction takes a transaction-scoped advisory lock first, so a deployment that took over a stalled run's lease waits for that run's open migration instead of failing with a duplicate-object error.
- Transactional migrations re-check the migration table inside their own transaction and report a migration another run applied first as skipped.
- SQLite: `migrateToLatest()` creates an empty `{tablePrefix}write_lock` table, and every migration transaction takes SQLite's write lock up front through it, so other processes wait for the lock (up to the connection's busy timeout) instead of failing.
