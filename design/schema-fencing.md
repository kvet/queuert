# Schema fencing

Roll out a breaking migration without first stopping every process on the previous version. Older workers drain before the migration commits; any older process that still writes afterwards fails loudly instead of corrupting state.

- A `schema` row holds `version` and `min_compatible`, the oldest code version allowed to write.
- Workers read `min_compatible` on lease renewal and drain once their code falls below it.
- The migrator announces a breaking migration by raising `min_compatible`, waits for older workers to drain, then applies it.
- Each writable code version `N` has an empty table `fence_v<N>` that all of its writes reference. A breaking migration drops the old ones, so older writes fail. This catches what the drain cannot: enqueue-only clients and workers still running when the wait times out.

## Problem

Some migrations change the meaning of a write, so older code running beside them corrupts state:

- `002_worker_liveness` (0.17): pre-0.17 workers claim jobs without an attempt token, which 0.17 cannot reclaim.
- `003_blocker_counters` (planned): a 0.17 attacher does not set `has_dependents`, so the dependent stays `blocked` forever.

Today each ships with a "stop every older process first" rule that only the release notes enforce. A rolling deploy or a forgotten producer breaks it, and the failure shows up later as stuck jobs.

## Prior art

- **pg-boss** and **graphile-worker** check the schema version at startup only.
- **Graphile Worker Pro** drains old workers before a breaking migration, but does not cover enqueue-only clients.
- **River**, **Oban** and **GoodJob** split breaking changes across releases.
- **Cadence** and **Temporal** check a current and a minimum compatible version at server start.

None fences writes in the database. This design adds that to a startup check and a drain.

## Design

### Versions

- Each adapter has `SCHEMA_VERSION`, the highest schema version it understands.
- A migration may declare its `version` and whether it is `breaking`. A breaking migration raises `min_compatible` to its `version`; an additive one raises only `version`.
- Code may write when `SCHEMA_VERSION >= min_compatible`. Code newer than the schema runs `migrateToLatest` first, as today.
- Migrations stay identified by name; versions live in the `schema` row.

`003_schema_fence` is version 3 and not breaking: it sets `version = 3`, `min_compatible = 2`, so 0.17 keeps running beside it.

### Schema table

```sql
CREATE TABLE {{schema}}.{{table_prefix}}schema (
  id              integer PRIMARY KEY CHECK (id = 1),
  version         integer NOT NULL,
  min_compatible  integer NOT NULL
)
```

### Write fence

```sql
CREATE TABLE {{schema}}.{{table_prefix}}fence_v3 (id integer PRIMARY KEY)
```

- A migration to version `N` creates `fence_v<N>`. A breaking one also drops every `fence_v<K>` with `K < N`.
- Every insert or update of `job`, `job_blocker` or `worker` carries `NOT EXISTS (SELECT 1 FROM {{fence_table}} WHERE 1 = 0)`, in the `WHERE` of an update or through `INSERT … SELECT … WHERE`.
- The guard is always true and reads no rows. It only makes the statement name the fence table, so it can never turn a write into a silent no-op.
- Reads and deletes are not fenced.

On **PostgreSQL**, `DROP TABLE` waits for open transactions that already referenced the fence table, which commit first. Every later statement fails with 42P01 at any isolation level, including prepared statements, because table lookup uses the current catalog, not the snapshot. This is a lock conflict, not a snapshot read, so it satisfies [PostgreSQL isolation levels](pg-isolation-levels.md). The drop runs with `lock_timeout = '5000ms'`, and the migrator retries on a lock timeout or deadlock up to 5 times.

On **SQLite**, the drop runs in the migration's write transaction. Earlier prepared statements fail with `no such table` on their next run, and a stale WAL reader fails its first write with `SQLITE_BUSY_SNAPSHOT`.

MySQL and MongoDB are covered in their own designs: [MySQL](mysql-adapter.md#schema-fencing), [MongoDB](mongodb-adapter.md#schema-fencing).

0.17 references no fence table, so it is never fenced and does not drain. The first breaking release keeps a manual stop rule for 0.17.

### Fenced errors

The state provider owns the driver, so it classifies errors. Each provider gains `classifyError({ error })`, returning an error of its own dialect, or `undefined` if unrecognized. Adapters parse no driver errors.

```ts
export type PgStateProviderError =
  | { kind: "undefined_table"; table?: string } // 42P01
  | { kind: "lock_timeout" } // 55P03
  | { kind: "deadlock" }; // 40P01

export type SqliteStateProviderError = { kind: "undefined_table"; table: string }; // no such table
```

- Each type lists only the kinds its adapter acts on. New kinds arrive with the feature that needs them, such as `serialization_failure` for the isolation-levels work.
- `table` is optional on PostgreSQL because the server reports it only in a translated message.
- The adapter turns an `undefined_table` from one of its writes into `SchemaFencedError` with `codeVersion` and, when known, `minCompatible`. Anything else is rethrown unchanged.

Client methods throw `SchemaFencedError`. A worker whose write is fenced aborts its attempts, does not write its stop and does not register again. Another worker reclaims its jobs once its lease lapses.

### Workers

- `start()` and every registration throw `SchemaFencedError` when `min_compatible > SCHEMA_VERSION`.
- `extendWorkerLease` returns `minCompatible`. A worker below it drains: it stops acquiring, lets in-flight attempts finish, deletes its worker row and stops. Its fence table still exists until the migration commits, so those attempts complete.
- `worker` gains `writer_version smallint NOT NULL DEFAULT 2`, set on registration and renewal, so the drain can find older workers. No other table stores a version.
- Both outcomes log `worker_fenced`.

### Clients

`createClient` reads the schema row once. It throws `SchemaFencedError` when the code is too old, and logs `schema_ahead` when `version` is newer but `min_compatible` still allows it. It skips the check before the schema exists. A long-lived client relies on the write fence.

### Migrator

When pending migrations include a breaking one:

1. **Announce.** Outside the migration lock, raise `min_compatible` to the highest pending breaking `version`. Older code still writes, but no older worker or client can start.
2. **Drain.** Poll `worker` until no live worker is below the new minimum, or `maxMigrationWaitMs` passes. This takes at least one lease renewal.
3. **Migrate.** Take the lock and apply; the breaking migration drops the old fence tables.

The announce is idempotent, so concurrent or interrupted migrators are safe. `MigrationResult.fencedWorkerIds` lists the workers the drain stopped waiting for. The migrator reaches the tables through the `MigrationStore` hooks `announceMinCompatible` and `listWorkersBelow`, implemented by PostgreSQL and SQLite. Both skip announce and drain before the `schema` table exists.

### In-process adapter

It never runs beside older code, so its fence is a no-op. `getSchemaInfo` and `extendWorkerLease` report its own version.

## Alternatives

A spike compared five fences on PostgreSQL 17, MySQL 8.4, MariaDB 11.4 and SQLite.

- **Stamp and check:** a `writer_version` column on every table plus a `CHECK` each breaking migration raises. MySQL and MariaDB cannot add a check without validating existing rows, and SQLite must rebuild the tables, which takes 327 ms at 200k jobs.
- **Stamp and trigger:** the same column, checked by a trigger. It works everywhere but stores a version on every row.
- **Session trigger:** a trigger checks a session variable. It is impossible on SQLite.
- **Fence table guarded by `EXISTS`:** a guard that reads a row, so it can turn writes into no-ops. It costs 8% on PostgreSQL.
- **Self-check against the `schema` row:** a snapshot read, so it breaks under REPEATABLE READ.

Throughput change against no fence, median of 7 quiet-machine rounds:

| Fence                 | PostgreSQL | MySQL | MariaDB | SQLite |
| --------------------- | ---------- | ----- | ------- | ------ |
| Stamp and check       | −0.6%      | −1.0% | −1.2%   | +1.4%  |
| Stamp and trigger     | −1.9%      | −0.4% | −1.3%   | −0.7%  |
| Session trigger       | −2.2%      | +0.7% | −1.4%   | —      |
| Fence table, `EXISTS` | −8.4%      | −2.9% | −4.2%   | −1.0%  |
| Fence table, no scan  | −1.2%      | +0.6% | −3.9%   | −1.4%  |
| Baseline spread       | 1.4%       | 2.0%  | 0.6%    | 1.0%   |

Only MariaDB's 4% for fence tables stands out from noise. It is accepted for a fence with no per-row storage that works on every database. Stamp and trigger is the fallback.

## Rollout

- `003_schema_fence` ships alone and is not breaking.
- `003_blocker_counters`, renumbered, becomes the next breaking migration; only 0.17 processes must be stopped by hand.
- After that, rolling deploys work.

## API

- `SchemaFencedError`, thrown by client methods, `createClient` and the worker's `start()`.
- `migrateToLatest({ maxMigrationWaitMs })` on PostgreSQL and SQLite, default 10 minutes; `MigrationResult.fencedWorkerIds`.
- State provider: `classifyError`, `PgStateProviderError`, `SqliteStateProviderError`. Breaking for custom providers.
- State adapter: `getSchemaInfo()` returning `{ codeVersion, version, minCompatible }` or `undefined`; `extendWorkerLease` returns `minCompatible`; writes reference the fence table. Breaking for custom adapters.
- Conformance: `StateConformanceFixture.withWritesFenced`; `withWritesFenced` on the PostgreSQL and SQLite adapters; `runPgStateProviderConformance` and `runSqliteStateProviderConformance` in their `testing` entry points.
- Docs: the integration pages cover the drain, the fence and `classifyError`; the worker reference covers draining; the schema reference lists `schema`, the fence tables and `worker.writer_version`.

## Tests

- **State adapter conformance:**
  - `getSchemaInfo` and `extendWorkerLease` report the versions.
  - A schema fence group runs inside the optional fixture hook `withWritesFenced(fn)`, which drops the fence table while `fn` runs and restores it afterwards. Every write throws `SchemaFencedError` and changes nothing, reads still work, and writes recover afterwards.
  - Every provider already runs this suite, so it checks each provider's `undefined_table` end to end.
- **Provider conformance:**
  - `runPgStateProviderConformance` checks `undefined_table`, `lock_timeout`, `deadlock`, and `undefined` for other errors.
  - `runSqliteStateProviderConformance` checks `undefined_table` with its name, and `undefined`.
  - Examples run these in their `conformance` region.
- **SQL adapters:** every insert/update template references `{{fence_table}}`.
- **Worker suite:** a drain finishes in-flight attempts and stops for good; a fenced write stops the worker; `start()` refuses old code.
- **Client:** too-old code is refused; a newer schema logs a warning.
- **Migrator:** waits for the drain; migrates after `maxMigrationWaitMs` and reports `fencedWorkerIds`; PostgreSQL retries on a lock timeout or deadlock.
- **Logging:** `schema_ahead` and `worker_fenced`.
- **Migration specs:**
  - `003_schema_fence` upgrades 0.17 without rewriting tables.
  - After a breaking migration, an older adapter's insert and update fail with `SchemaFencedError`. This includes a REPEATABLE READ transaction begun before the migration on PostgreSQL, and a statement prepared before it on SQLite.

## Open questions

- Should a migrator that fails after announcing lower `min_compatible` back? Today a rollback needs a manual `UPDATE {prefix}schema SET min_compatible = <previous>`.
