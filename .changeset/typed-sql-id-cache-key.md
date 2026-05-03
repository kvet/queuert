---
"@queuert/postgres": minor
"@queuert/sqlite": minor
---

`executeSql`'s `id` now uniquely identifies the resolved SQL within a provider — the template applier folds variants like `schema` / `tablePrefix` into a hashed suffix. Custom providers can cache prepared-statement handles directly by `id` without keeping their own SQL-keyed maps. The built-in `pg.Pool` provider drops its SHA1 name-hash (`query.name = id`); the built-in `better-sqlite3` and `node:sqlite` providers drop the per-database SQL→Statement map and key the cache by `id`.
