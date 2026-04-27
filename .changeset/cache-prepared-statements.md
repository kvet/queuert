---
"queuert": minor
"@queuert/postgres": minor
"@queuert/sqlite": minor
---

Cache prepared statements via a stable id.

The `sql()` helper now accepts an optional `id` on `TypedSql` definitions, and the built-in providers thread it through `executeSql` as a stable cache key. Built-in adapters tag every reusable statement with an id and omit it for one-off / dynamic SQL (e.g. savepoints), so dynamic queries still execute unprepared.

### What providers do with `id`

- **`@queuert/postgres`** — `createPostgresJsProvider` calls `sql.unsafe(query, params, { prepare: true })` whenever `id` is set, opting the statement into postgres.js's server-side prepared-statement cache. `createPgPoolProvider` (pg) sets `query.name = "q_" + sha1(id + sql).slice(0, 12)`, which lets pg cache the parsed plan per connection. When `id` is omitted both providers fall back to unprepared execution.
- **`@queuert/sqlite`** — `createBetterSqlite3Provider` and `createNodeSqliteProvider` cache `db.prepare(sql)` handles in a per-database `WeakMap<Database, Map<sql, Statement>>` when `id` is set, and re-prepare on every call when it is omitted. Both providers also gain an optional `close()` that drops the cache for the wrapped database.

### `executeSql` contract change

The `id` field on the `executeSql` argument is **optional** (`id?: string`) on both `PgStateProvider` and `SqliteStateProvider`. Custom provider implementations continue to type-check unchanged — they will simply execute every statement unprepared. To opt into caching, accept `id` and use it as you see fit (statement cache key, `pg` query name, postgres.js `prepare` toggle, etc.).

### Notes for transaction-mode poolers

Server-side prepared statements break under transaction-pooling proxies such as PgBouncer or Supavisor. If you front your database with one of those, write a custom provider that ignores `id` (or wire your driver's "disable prepare" knob) so statements stay unprepared.
