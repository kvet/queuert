# MySQL / MariaDB state adapter

Add a state adapter for MySQL and MariaDB (InnoDB) in a new `@queuert/mysql` package. The package has one adapter that covers both servers through a small dialect switch, plus a `MysqlStateProvider` contract with reference providers for mysql2, the mariadb connector, Drizzle and Kysely. The adapter is correct at READ COMMITTED, REPEATABLE READ (the InnoDB default) and SERIALIZABLE, because it ships the counter-based blocker bookkeeping from `design/pg-isolation-levels.md` from its first migration, and it pins the transactions Queuert opens itself to READ COMMITTED.

Every behavioral claim marked _(spike)_ was verified against MySQL 8.0.46, MySQL 8.4.13, MariaDB 10.11.19, MariaDB 11.4.13 and MariaDB 11.8.9 using mysql2 3.24 and mariadb 3.5. See [Spike](#spike).

## Problem

PostgreSQL and SQLite are the only SQL backends. Teams that run MySQL or MariaDB (or Aurora MySQL, or Cloud SQL for MySQL) cannot get Queuert's main guarantee, that jobs are written in the same transaction as the application's data, without adding a second database.

The PostgreSQL adapter cannot be ported line by line. Its statements depend on features that InnoDB servers lack or implement differently:

- **No data-modifying CTEs and no `UPDATE … RETURNING`** on either server. MariaDB has `INSERT/DELETE … RETURNING` (10.5+); MySQL has neither. Every PostgreSQL write that is one `WITH … UPDATE … RETURNING` statement becomes several statements.
- **No arrays and no `unnest`.** Batches have to be passed as JSON and expanded with `JSON_TABLE`.
- **No partial indexes.** MySQL has functional indexes; MariaDB has neither.
- **No `LATERAL` on MariaDB.** On MySQL, `LATERAL` with an inner `FOR UPDATE SKIP LOCKED` locks every candidate row _(spike)_.
- **DDL commits implicitly**, so no migration is atomic.
- **REPEATABLE READ is the default isolation level**, and InnoDB's version of it does not behave like PostgreSQL's (see [Isolation and locking](#isolation-and-locking)). Most users will pass in REPEATABLE READ transactions without knowing it, so correctness at RR is a requirement, not an option.
- **No `LISTEN/NOTIFY`**, so there is no database notify adapter.

## Packaging: one adapter, two dialects

Ship one package, `@queuert/mysql`, exporting `createMysqlStateAdapter` and the `MysqlStateProvider` type. Do not ship a separate `@queuert/mariadb`.

The work that is hard is the same on both servers:

- splitting writes into multiple statements
- batching through `JSON_TABLE` with charset-matched columns
- per-type acquisition picks
- tail lookups through correlated subqueries
- generated columns in place of partial indexes
- `UTC_TIMESTAMP(6)`
- idempotent, non-atomic migrations
- counter-based blocker bookkeeping

The `startJobAttempts` shape that stays lock-bounded is the same on both servers _(spike)_. Two adapters would duplicate about 2,500 lines to save one round trip here and there on MariaDB.

The differences are small and local, so the adapter resolves them into template variables:

| Concern                     | MySQL 8.0.19+                                   | MariaDB 10.6+                                                   |
| --------------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| Exact, NO PAD collation     | `utf8mb4_0900_bin`                              | `utf8mb4_nopad_bin` (no `0900_bin` on 10.11)                    |
| Locking a join's subset     | `FOR UPDATE OF h`                               | not available: lock through `WHERE id IN (SELECT … JSON_TABLE)` |
| Idempotent DDL              | `information_schema` probes, or catch 1060/1061 | `IF [NOT] EXISTS`                                               |
| `RETURNING` shortcuts       | none                                            | `INSERT/DELETE … RETURNING` (optional, phase 2)                 |
| Statement timeout variable  | `max_execution_time`                            | `max_statement_time`                                            |
| `innodb_snapshot_isolation` | not present                                     | present; default ON from 11.6, OFF on 11.4                      |
| Error numbers               | 1213, 1205                                      | 1213, 1205, 1020 (snapshot isolation), 4025 (CHECK)             |

The adapter uses the portable form wherever one exists. `LOCK IN SHARE MODE` is used on both servers, because MariaDB does not parse `FOR SHARE`. `JSON_CONTAINS` is used on both servers, because MariaDB has no `MEMBER OF`. Correlated subqueries are used instead of `LATERAL`.

**Dialect detection.** `createMysqlStateAdapter` is already async. It runs `SELECT VERSION()` once, through `executeSql` without a `txCtx`, picks `mysql` or `mariadb`, and throws if the server is below the minimum version. A `dialect` option skips the query, for setups where the factory must not touch the database.

**Minimum versions.**

- **MySQL 8.0.19+**, with 8.4 LTS recommended. The adapter needs `SKIP LOCKED`, `JSON_TABLE`, enforced `CHECK`, expression `DEFAULT`, generated columns and window functions. The point-release numbers behind the minimum come from the MySQL release notes, not from the spike.
- **MariaDB 10.6+**, which adds `JSON_TABLE` and `SKIP LOCKED`. CI tests 10.11 and 11.4 (the LTS releases) and 11.8 (snapshot isolation ON).
- MySQL 5.7 and MariaDB ≤ 10.5 are not supported.

**Out of scope:**

- Vitess / PlanetScale, which rejects some constructs.
- TiDB.
- Galera / Group Replication in multi-primary mode, where conflicts surface at commit and `SKIP LOCKED` is node-local.
- Multiplexing proxies (ProxySQL) that break session state.

Aurora MySQL and Cloud SQL are expected to work like stock MySQL, but this was not tested.

**Notify.** InnoDB servers have nothing like `LISTEN/NOTIFY`. The package ships no notify adapter. The docs pair the MySQL state adapter with the Redis or NATS notify adapter, or with none, which falls back to polling.

## Provider contract

`MysqlStateProvider<TTxContext>` has the same shape as `PgStateProvider`: `withTransaction`, `isTransaction`, `executeSql({ txCtx, id, sql, params, paramTypes, columnTypes, readOnly })` and an optional `close`. The contract adds the following requirements, all of which the reference providers implement:

- **`withTransaction` runs at READ COMMITTED.** It issues `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` and then `START TRANSACTION` on the same connection, with nothing between them.
  - An unused `SET TRANSACTION` leaks into the next pool user's transaction _(spike)_.
  - `@@transaction_isolation` keeps reporting the session level even inside such a transaction _(spike)_. A conformance case therefore verifies the level through `information_schema.innodb_trx.trx_isolation_level` after taking a lock.
  - The transactions a user passes in run at the user's level.
- **Sessions run in UTC.** Every connection runs `SET time_zone = '+00:00'`, through mariadb `initSql`, a mysql2 `connection` event, or lazily on first acquire. Drivers must not shift DATETIMEs: mysql2 needs `timezone: 'Z'` or `dateStrings: true`, because its default `'local'` shifted every value by the host offset _(spike)_. ORM providers share the user's pool, so this becomes documented pool configuration.
- **Placeholders are `?`.** The adapter repeats a value where PostgreSQL would reuse `$1`. Named placeholders are mysql2-only and are not used.
- **`id` means prepared.** With `id`, the provider uses the binary protocol (`execute`). Without it, the provider may use the text protocol.
  - Kysely only has the text protocol, where `LIMIT '2'` fails, so the adapter always passes numbers for numeric parameters.
  - `max_prepared_stmt_count` (16,382 per server) is shared across all connections, so dynamic SQL omits `id`, as in PostgreSQL.
- **Single statements only.** Providers must not enable `multipleStatements`. With `NO_BACKSLASH_ESCAPES` in the session's `sql_mode`, mysql2's text-protocol interpolation is injectable _(spike)_. Multi-statement round trips can come later as an opt-in limited to safe drivers. See [Open questions](#open-questions).
- **`isTransaction`.**
  - The mariadb connector answers truthfully and synchronously from `connection.info.status & 1` (SERVER_STATUS_IN_TRANS), including after an implicit commit.
  - mysql2 keeps no such flag, so its provider tracks a `WeakSet` marker. That marker cannot see a transaction the caller opened with `beginTransaction()` outside the provider, and it stays `true` after a DDL implicit commit. Both limits are documented.
  - Drizzle (`instanceof MySqlTransaction`) and Kysely (`isTransaction`) behave like the marker.
- **Connection-owning providers serialize access.** A provider over a single `Connection` serializes `withTransaction` and non-transactional `executeSql` behind a FIFO mutex. Without the mutex, a non-transactional write issued during an open transaction was rolled back with it _(spike)_.

The adapter, not the provider, normalizes driver output using `columnTypes`. This covers 0/1 booleans, `bigint` and string numbers, JSON returned as a string, and `'YYYY-MM-DD HH:MM:SS.ffffff'` datetimes, which are parsed as UTC (JavaScript would parse them as local time). Providers stay thin pass-throughs, as they are in PostgreSQL.

**Reference providers** live in examples, following the PostgreSQL and SQLite naming:

- `state-mysql-mysql2`, with a Pool and a single-Connection variant
- `state-mysql-mariadb`
- `state-mysql-drizzle` (mysql2)
- `state-mysql-kysely`, which needs the callback-style mysql2 pool: given a `mysql2/promise` pool it hangs silently _(spike)_
- `state-mysql-knex`
- `state-mysql-prisma` (not spiked)

Each example runs `runStateAdapterConformance`.

## Schema

The schema reuses the PostgreSQL column names, including the counters from `design/pg-isolation-levels.md`. `{{schema}}` is the database name. Identifiers are written with backticks, and `index` is a reserved word. Strings use single quotes, so `ANSI_QUOTES` in `sql_mode` cannot break them.

| PostgreSQL                     | MySQL / MariaDB                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `uuid` ids                     | `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin`                                             |
| `text` ids                     | `VARCHAR(n)` in the dialect's NO PAD binary collation                                        |
| `timestamptz`                  | `DATETIME(6)`, UTC, `DEFAULT (UTC_TIMESTAMP(6))`                                             |
| `statement_timestamp()`        | `UTC_TIMESTAMP(6)`: constant within a statement, different between statements _(spike)_      |
| `jsonb`                        | `JSON` (binary on MySQL, `LONGTEXT` + `json_valid` CHECK on MariaDB)                         |
| `text[]` (`worker.type_names`) | `JSON` array, matched with `JSON_CONTAINS`                                                   |
| `gen_random_uuid()`            | generated in JS (`crypto.randomUUID()`); `UUID()` is v1 and `UUID_v4()` is MariaDB 11.8 only |
| `type_name`, dedup key `text`  | `VARCHAR(n)` in the dialect's NO PAD binary collation                                        |
| `CHECK (status IN …)`          | the same `CHECK` (enforced on both servers)                                                  |

**Timestamps.** `TIMESTAMP(6)` is rejected because it is converted through the session time zone and stops at 2038 everywhere except MariaDB 11.8 _(spike)_. The adapter writes datetimes as `'YYYY-MM-DD HH:MM:SS.ffffff'` in UTC. ISO strings ending in `Z` are rejected by plain `INSERT … VALUES`, and MariaDB turns garbage silently into `0000-00-00` even with `ERROR ON ERROR` _(spike)_.

**Collations are part of correctness.** Under the default collations, dedup keys, type names and ids match case- and accent-insensitively. For example, `utf8mb4_0900_ai_ci` matched `Alpha`, `alpha` and `álpha`. MariaDB `uca1400_ai_ci` also ignores trailing spaces. Even `utf8mb4_bin` and `ascii_bin` are PAD SPACE, so `'a' = 'a '` _(spike)_. Every comparison Queuert relies on must be exact, so:

- type names and dedup keys use the dialect's NO PAD binary collation;
- canonical lowercase UUID ids can stay `ascii_bin`, because they never carry trailing spaces;
- free-form `VARCHAR` ids use the NO PAD collation.

**`jobIdType` / `workerIdType` become presets** (`"uuid"` and `"varchar(n)"`) instead of raw SQL type names. Each preset resolves to three templates:

- the column DDL;
- the matching `JSON_TABLE` column type;
- an optional encode/decode expression, which is unused for v1.

The `JSON_TABLE` column must use the same charset as the indexed column. A `CHAR(36)` utf8mb4 `JSON_TABLE` column joined against an `ascii_bin` primary key ignored the index, and on MariaDB a 1,000-id join took 2–3 s instead of 2–3 ms _(spike)_. `BINARY(16)` and MariaDB's native `UUID` type both worked, but they need per-dialect encode/decode SQL; they are deferred.

**Indexes.** There are no partial indexes, and NULLs are indexed, so no option is sparse. A generated column saves index width but not entries.

| PostgreSQL partial index                                | MySQL / MariaDB                                                                                                                                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `job_pending/blocked/running/completed_idx`             | one index `(type_name, status, status_ts)` on a stored generated column `status_ts = CASE status WHEN 'running' THEN attempt_at WHEN 'completed' THEN completed_at ELSE scheduled_at END` |
| `chain_index_idx` unique `WHERE chain_index > 0`        | plain `UNIQUE (chain_id, chain_index)`: a head is `(id, 0)` and its id is the primary key, so heads cannot collide                                                                        |
| `chain_deduplication_idx`                               | `(chain_deduplication_key, type_name, chain_index, created_at)`                                                                                                                           |
| `chain_idx`, `chain_running_idx`, `chain_completed_idx` | `(type_name, chain_index, created_at)` and `(type_name, chain_status, created_at)` / `(…, chain_completed_at)`; `chain_status` is set on heads only                                       |
| `job_attempt_by_idx`                                    | `(attempt_by, status, attempt_at)`                                                                                                                                                        |

Statements reference generated columns explicitly. Functional indexes are fragile in practice:

- MySQL stores the expression with a charset-tagged literal (`_ascii'pending'`), so a query with a plain `'pending'` does not match the index and falls back to a filesort _(spike)_.
- MariaDB ≤ 11.4 never substitutes an inline expression with a virtual-column index.

Locking statements use `FORCE INDEX`. On small tables the optimizer chose full scans, and the locking scans then deadlocked _(spike)_.

## Statements

### Translation rules

1. **Batches arrive as one JSON parameter** expanded with `JSON_TABLE(?, '$[*]' COLUMNS (ord FOR ORDINALITY, …))`. This works with server-side prepared statements on all five servers. A 1,000-row `INSERT … SELECT` takes 16–45 ms, which is the same as multi-row `VALUES` _(spike)_.
   - JSON payloads (`input`, `output`, errors) are sent as a pre-stringified `LONGTEXT PATH` column and inserted with `JSON_EXTRACT(x, '$')`.
   - A `JSON PATH` column behaves differently per server. MariaDB returns JSON `null` as the literal `'null'`, and `JSON_OBJECT` over such a column double-encodes it _(spike)_. `CAST(x AS JSON)` is MySQL-only.
2. **A write that is one statement in PostgreSQL becomes a short sequence in one transaction.** The sequence locks or writes by keys known in JS (ids, the attempt tokens generated in JS), then reads the rows back. When the caller passes no `txCtx` to a method that needs several statements (`startJobAttempts`, `rescheduleJobs`, `startWorker`, `extendWorkerLease`, `stopWorker`), the adapter opens its own transaction through `withTransaction`. A lone `SELECT … FOR UPDATE` in autocommit would release its lock immediately.
3. **Results come from read-backs, not from `affectedRows`.** Both drivers default to CLIENT_FOUND_ROWS, so a matched no-op reports 1, the same as an insert _(spike)_. The adapter must not depend on the driver's flag setting.
4. **Never `UPDATE t … WHERE id IN (SELECT … FROM t)`.** MySQL rejects it (1093). Use a multi-table `UPDATE t JOIN JSON_TABLE(…)`, or a single-table `UPDATE` whose subqueries read other tables.
5. **Single-table `UPDATE … ORDER BY id`** orders lock acquisition, which a multi-table `UPDATE` cannot do. Use it wherever several rows of `job` are written.
6. **SET expressions must not depend on assignment order.** MySQL evaluates single-table assignments left to right but gives no order guarantee for multi-table updates, and MariaDB's `SIMULTANEOUS_ASSIGNMENT` mode switches to standard semantics. Assign columns derived from a counter before the counter itself, and write every expression in terms of the old values. The expression is then correct under both semantics.
7. **Reads that decide a write are current reads** (`FOR UPDATE`, `LOCK IN SHARE MODE`, or a subquery inside an `UPDATE`). Never use a plain `SELECT` for these, and never a subquery under `SELECT … FOR UPDATE`. See [Isolation and locking](#isolation-and-locking).
8. **No dependence on session `sql_mode`.** That means no double-quoted strings, no backslash escapes in literals and no reliance on `ONLY_FULL_GROUP_BY` leniency. The adapter checks that `STRICT_TRANS_TABLES` is set and throws at creation if it is not. Without it, MySQL truncates instead of failing.

### Per method

Round trips per call. PostgreSQL uses one statement for each method, except `deleteChains` and `unblockJobs`, which use two.

| Method                                             | Statements                                                                                                                                                                                                  | Round trips |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `createJobs`                                       | `INSERT … SELECT FROM JSON_TABLE … WHERE NOT EXISTS (dedup match)`; in-batch dedup in JS; read-back by id plus dedup matches                                                                                | 2 _(spike)_ |
| `continueJobs`                                     | `UPDATE … JOIN JSON_TABLE` (complete, token check); `INSERT … SELECT` successors joined to the completed rows; read-back                                                                                    | 3           |
| `completeJobs`                                     | `UPDATE job JOIN JSON_TABLE` (complete); `UPDATE` heads to `chain_status = 'completed'`; read-back including `has_dependents`                                                                               | 3 _(spike)_ |
| `rescheduleJobs`                                   | `UPDATE … JOIN JSON_TABLE`; read-back                                                                                                                                                                       | 2           |
| `startJobAttempts`                                 | lease-gate read on the worker row; per-type picks (see [Acquisition](#acquisition)); `UPDATE … JOIN JSON_TABLE` with JS-generated tokens; read-back                                                         | 3 + types   |
| `getStartAttemptDelayMs`                           | per-type `due` probe and `upcoming` minimum, combined with `UNION ALL`                                                                                                                                      | 1           |
| `addJobsBlockers`                                  | lock heads `ORDER BY id FOR UPDATE`; set `has_dependents`; `INSERT job_blocker`; `UPDATE` dependents (counter + status); read-back                                                                          | 4–5         |
| `unblockJobs`                                      | one ordered decrement `UPDATE` (see [Completion](#completion)); read-back                                                                                                                                   | 2           |
| `deleteChains`                                     | lock members; read external refs and rows to return; `DELETE` blockers and jobs (MariaDB: `DELETE … RETURNING` saves one)                                                                                   | 3–4         |
| `startWorker` / `extendWorkerLease` / `stopWorker` | write, then read-back (MariaDB `INSERT/DELETE … RETURNING`: 1)                                                                                                                                              | 2           |
| `getChains` / `getJobs` / `getWorkers`, locked     | `WHERE id IN (SELECT … FROM JSON_TABLE(?)) … FOR UPDATE`: MySQL rejects plain `FOR UPDATE` with `JSON_TABLE` in `FROM` (`ER_DUPLICATE_TABLE_LOCK`), and MariaDB's also locks the joined tail rows _(spike)_ | 1           |
| Reads, counts, lists                               | one statement each                                                                                                                                                                                          | 1           |

Notes on specific reads:

- **Chain tail without `LATERAL`:** `LEFT JOIN job t ON t.id = (SELECT t2.id … WHERE t2.chain_id = h.id AND t2.chain_index > 0 ORDER BY t2.chain_index DESC LIMIT 1)`. It gives `eq_ref` plus `ref` on all servers _(spike)_.
- **`getChainTypeNames` / `getJobTypeNames`:** a plain `SELECT DISTINCT type_name` gets a loose index scan in about 0.5 ms. Porting PostgreSQL's recursive-CTE skip scan is a trap: it took 1–1.6 s on MySQL _(spike)_.
- **Capped counts:** `COUNT(CASE …)` replaces `FILTER`. A per-type count over a covering index takes 2–4 ms.
  - The portable multi-type form is a dynamic `UNION ALL` per type, with parameters repeated, because MariaDB rejects correlated references inside derived tables.
  - It is dynamic SQL, so it carries no `id`.
- **`row_to_json` becomes explicit column lists** with a prefix per alias (`h_…`, `t_…`). `JSON_OBJECT` is only used where a variable-length list must be returned. `JSON_ARRAYAGG(… ORDER BY)` is MariaDB-only, so ordering is done in JS.

## Isolation and locking

### What InnoDB does differently

Each fact below was verified on all three tested lines (MySQL 8.4, MariaDB 11.4, MariaDB 11.8) _(spike)_:

- **Current reads see past the snapshot at any level.** `FOR UPDATE`, `LOCK IN SHARE MODE`, `UPDATE` and `DELETE` read the latest committed version, including phantom rows. A plain `SELECT` at RR reads a snapshot fixed at the transaction's first consistent read, not at `START TRANSACTION`. With the default settings, a write over a row that changed after the snapshot raises no error. PostgreSQL's 40001 has no counterpart.
- **A subquery under `SELECT … FOR UPDATE` is a snapshot read.** A subquery inside an `UPDATE` is a current read. In `SELECT … WHERE id IN (SELECT job_id FROM job_blocker …) FOR UPDATE`, the subquery missed a `job_blocker` row committed after the snapshot.
- **RR takes next-key and gap locks on locking range scans.** RC takes none, apart from duplicate checks.
- **SERIALIZABLE turns plain `SELECT`s into share-locking reads** inside a transaction. This masks plain-read bugs, at the cost of more lock waits and deadlocks.
- **MariaDB `innodb_snapshot_isolation`:**
  - It defaults ON from 11.6 and is OFF on 11.4.
  - While ON, at RR and SERIALIZABLE, a locking read or write of a row changed after the snapshot raises **1020** and rolls back the whole transaction.
  - It does not fix plain-read bugs.
- **Error effects:**
  - **1213** (deadlock) rolls back the whole transaction, and the connection then continues in autocommit.
  - **1205** (lock wait timeout) rolls back only the statement. The transaction stays open with its earlier writes, unless the server runs with `innodb_rollback_on_timeout`.

### Races

These are the blocker races from `design/pg-isolation-levels.md`, run with two connections and controlled interleavings. Every transaction first runs a plain `SELECT`, which fixes its snapshot. Cell values: "stuck" means the dependent stayed `blocked` with no incomplete blockers. "Retry" means one side raised the listed error and a retry succeeded.

| Variant                                          | Race                                   | RC           | RR                              | SER                             |
| ------------------------------------------------ | -------------------------------------- | ------------ | ------------------------------- | ------------------------------- |
| Today's statements, literally translated         | attach vs completion                   | ok           | **stuck**                       | ok (MariaDB 11.8: 1020 → retry) |
|                                                  | two blockers of one dependent complete | ok           | **stuck**                       | 1213 → retry                    |
| Lock-then-recheck with every read a current read | attach vs completion                   | ok           | ok                              | ok                              |
|                                                  | two blockers complete                  | 1213 → retry | 1213 → retry                    | 1213 → retry                    |
| Counters, `job_blocker` read by plain `SELECT`   | attach vs completion                   | ok           | **stuck**                       | ok                              |
| Counters, current reads (this design)            | all races                              | ok           | ok (MariaDB 11.8: 1020 → retry) | ok (MariaDB 11.8: 1020 → retry) |

Under load (8 connections, 200 dependents × 16 blockers, RR), the literal translation left 200 of 200 dependents stuck on every server. The current-read lock-then-recheck variant deadlocked about 84 times, at RC as well, because its recheck needs a share lock on a blocker head that the other completer holds exclusively. The counter design left 0 stuck with 0 errors, except on MariaDB 11.8 with snapshot isolation ON, where it needed about 84 retries of 1020. No counter drift was observed _(spike)_.

### Design

**Counters from day one.** The `job` table has `has_dependents` and `blockers_remaining` in `001_initial_schema`, with the semantics of `design/pg-isolation-levels.md`. The rule stays the same: every invariant that pairs a read in one transaction with a write in another must be a write-write conflict on a shared row. InnoDB adds one more: **every read that drives such a write is a current read.**

#### Attach (`addJobsBlockers`)

1. Lock the blocker heads: `SELECT id, chain_status, has_dependents … WHERE id IN (SELECT … FROM JSON_TABLE(?)) AND chain_index = 0 ORDER BY id FOR UPDATE`.
2. Set `has_dependents = TRUE` on the locked heads where it is `FALSE`.
   - Writing only when it is false is enough on InnoDB, even at RR, unlike PostgreSQL _(spike)_.
   - The completer reads `has_dependents` from the head row it has just updated, so it sees its own version, which was built on the latest committed one.
3. Insert the `job_blocker` rows.
4. Update each dependent in one `UPDATE … JOIN JSON_TABLE`. The counts come from step 1: `blockers_remaining` is the number of its rows whose locked head is `running`, and `status` becomes `blocked` when that number is above zero and the job is still `pending`.

#### Completion

- `completeJobs` completes the job and its chain head as two `UPDATE`s, then reads back `has_dependents` from the head row. That row now carries the transaction's own version.
- Core skips `unblockJobs` when `hasDependents` is `false`, as in `design/pg-isolation-levels.md`. That contract change is a prerequisite.
- `unblockJobs` is one single-table `UPDATE … ORDER BY id`, so it takes its locks in id order:

  ```sql
  UPDATE job
  SET status = CASE WHEN blockers_remaining - (SELECT COUNT(*) FROM job_blocker jb WHERE jb.job_id = job.id AND jb.blocked_by_chain_id = ?) <= 0 THEN 'pending' ELSE status END,
      scheduled_at = CASE WHEN … same predicate … THEN GREATEST(scheduled_at, UTC_TIMESTAMP(6)) ELSE scheduled_at END,
      blockers_remaining = blockers_remaining - (SELECT COUNT(*) FROM job_blocker jb WHERE jb.job_id = job.id AND jb.blocked_by_chain_id = ?)
  WHERE status = 'blocked' AND id IN (SELECT job_id FROM job_blocker WHERE blocked_by_chain_id = ?)
  ORDER BY id
  ```

  - The subqueries read another table inside an `UPDATE`, so they are current reads, and MySQL's error 1093 does not apply.
  - The statement is written in terms of old values, so it is correct whatever the assignment order.
  - The spike verified the multi-table form, `UPDATE job JOIN (count over job_blocker GROUP BY job_id)`, on all servers. It was 10–25× faster than per-dependent decrements. The single-table `ORDER BY` variant above is the intended shape, but it is **not yet spiked**. If it misbehaves, the fallback is the verified multi-table decrement followed by a second `UPDATE … WHERE blockers_remaining = 0 AND status = 'blocked'` over the rows that statement already locked.

- A read-back returns one `StateDependentJob` per `job_blocker` row, as today.

#### Transaction isolation

**Transactions Queuert opens run at READ COMMITTED** (see [Provider contract](#provider-contract)). This is about performance and liveness, not correctness: the counter design is correct at RR too. At RR, acquisition's locking scans take gap locks:

- An `INSERT` of a new due job blocked until 1205 whenever a claim scan reached the end of the pending range, which is the normal state of a drained queue.
- On a drained queue at RR, MariaDB dropped from about 770 to about 97 completions/s, with 100–140 deadlocks in 10 s and producer p99 rising from 4 ms to about 200 ms. MySQL hit 215 deadlocks _(spike)_.

At RC: no gap locks, no errors. Lease renewals and other autocommit writes run at the session default. A failure there is a transient database error, which the worker already retries.

**Transactions users pass in** (client methods, `complete`, `fence`) run at the user's level:

- **RC:** correct with no retries.
- **RR (the MySQL default):** correct.
  - On MySQL and MariaDB ≤ 11.5 there are no serialization errors. Concurrent writers wait and then update the latest version.
  - The user's own locking range reads take gap locks as usual. Queuert's are point lookups by primary key, which take record locks only.
- **SERIALIZABLE:** correct, with more lock waits. Plain reads become share locks, so expect 1213 under contention.
- **MariaDB ≥ 11.6 at RR or SERIALIZABLE with `innodb_snapshot_isolation=ON`:** correct, but 1020 appears on benign interleavings too, such as a completion committing inside an attacher's snapshot. Fan-in onto one dependent averaged about 5 retries per completion in the spike. The docs recommend RC for transactions passed to Queuert on these servers, or `innodb_snapshot_isolation=OFF`.

**Errors in user transactions.** 1213 and 1020 fail the attempt or the client call like any other error, and the job is rescheduled with backoff. Retrying a client call is the caller's concern. 1205 leaves the transaction open with a statement missing. Queuert's own `withTransaction` rolls back on any throw, but a user who catches a 1205 from a Queuert call and commits anyway commits a partial write. The docs say a transaction that saw 1205 must be rolled back, and recommend `innodb_rollback_on_timeout=ON`.

### Acquisition

- `type_name IN (…) ORDER BY scheduled_at LIMIT n FOR UPDATE SKIP LOCKED` filesorts and **locks every due row of every listed type**, at every level including RC. A second worker then claimed nothing _(spike)_.
- MySQL `LATERAL` with an inner `LIMIT … FOR UPDATE SKIP LOCKED` does the same.
- Both shapes are forbidden.

`startJobAttempts` therefore issues one pick per type name, in random order like the PostgreSQL adapter. It stops once `limit` jobs are picked:

```sql
SELECT id FROM job FORCE INDEX (job_status_idx)
WHERE type_name = ? AND status = 'pending' AND status_ts <= UTC_TIMESTAMP(6)
ORDER BY status_ts LIMIT ? FOR UPDATE SKIP LOCKED
```

The pick locks exactly the rows it returns. 8 workers claimed 500 rows with no duplicates at every level on every server _(spike)_. The cost is one round trip per type until the batch fills. The alternative is one `UNION ALL` statement with a branch per type, which is one round trip, but it locks `types × limit` rows until commit and hides them from other workers. The per-type loop is the default; the benchmark in [Tests](#tests) decides whether `UNION ALL` is worth adding as a variant.

**Lease gate.** PostgreSQL gates claims on the worker row with `FOR KEY SHARE`, which does not conflict with lease renewal. InnoDB has no key-share lock. `LOCK IN SHARE MODE` on the worker row blocks `extendWorkerLease` until the claim commits, and blocks the reclaimer's `getWorkers({ lock: "exclusive" })`. Blocking the reclaimer is the intent. The renewal wait is bounded by one claim transaction. This path is **not yet spiked**: the tests must show that renewal latency stays bounded and that a claim, its renewal and a reclaim cannot deadlock.

## Migrations

DDL commits implicitly, and a failing DDL statement commits too _(spike)_. No migration is atomic, so:

- **Every migration is `non-transactional`**, using the migrator's existing type. Every statement is idempotent, so a crashed run resumes.
  - On MariaDB, idempotent means `IF [NOT] EXISTS`.
  - On MySQL, a statement carries an `information_schema` probe that the migration store runs first and that skips the statement, or the store treats `ER_DUP_KEYNAME` (1061) and `ER_DUP_FIELDNAME` (1060) as already applied. The probe is preferred, because it does not hide a real mismatch.
  - Data `UPDATE`s are written to be rerunnable.
  - `recordMigration` runs after the last statement.
- **The migration lock is the existing table lease.** It is ported to `INSERT … ON DUPLICATE KEY UPDATE locked_by = IF(locked_until <= UTC_TIMESTAMP(6), VALUES(locked_by), locked_by), …`, followed by a read-back, because `affectedRows` cannot tell an acquisition from a no-op. `GET_LOCK` is rejected: it is session-scoped and survives `COMMIT`, and a `RELEASE_LOCK` that runs on a different pooled connection returns 0, leaking the lock _(spike)_.
- **Metadata locks.** The default `lock_wait_timeout` is one year on MySQL and one day on MariaDB. A DDL statement behind an open reader transaction waits that long, and stalls every query queued behind it. The store sets `SET SESSION lock_wait_timeout = 5` on its connection, restores it afterwards, and retries. `SET LOCAL` is silently `SESSION` on these servers.
- **Online DDL.** Statements state `ALGORITHM=INSTANT` (add column) or `ALGORITHM=INPLACE, LOCK=NONE` (create index), so a migration that would copy the table fails instead of locking `job`.
- **Lineage.** The MySQL adapter starts at `001_initial_schema`, which includes the worker table, the attempt token and the counters. It does not replay PostgreSQL's history. Migration names are per adapter.
- `executeBatchMigrationStatement` becomes `UPDATE … LIMIT n`, using `affectedRows`. This is safe here because the statement always changes the rows it matches.

### Schema fencing

The adapter uses the fence tables of the PostgreSQL adapter's [write fence](../docs/src/content/docs/integrations/state-adapters/postgres.tsx#write-fence) from its first migration.

- **The drop comes first.** DDL commits implicitly, so a breaking migration drops the old `schema_fence_v<K>` tables in their own step, before its schema change. The fence holds before the incompatible schema exists.
- **Later writes fail at any isolation level.** They fail with `ER_NO_SUCH_TABLE` (1146).
- **An open transaction can deadlock on the drop.** A writer waiting on the drop's metadata lock inside an open transaction gets `ER_LOCK_DEADLOCK` (1213), as it would against any DDL. It then retries into the fence.
- **A version `CHECK` does not work.** A stamped `writer_version` column with a raised `CHECK`, an alternative to fence tables, cannot work: MySQL and MariaDB validate every existing row when a check is added, so raising it fails on rows written by older versions _(spike)_.
- **`MysqlStateProviderError` covers three kinds.** It declares `undefined_table` (1146), `lock_wait_timeout` (1205) and `deadlock` (1213).
- **The fence costs about 4% on MariaDB.** It costs +0.6% on MySQL, inside the noise. MariaDB's 4% is the one measurable cost in the spike.

## API

- New package `@queuert/mysql`. It exports:
  - `createMysqlStateAdapter({ stateProvider, schema?, tablePrefix?, jobIdType?, workerIdType?, dialect?, …common options })`
  - the `MysqlStateAdapter` type
  - the `MysqlStateProvider` type
  - `MigrationResult`
- `jobIdType` and `workerIdType` take presets (`"uuid"`, `"varchar(n)"`) instead of raw SQL type names.
- No notify adapter.
- Core: no change beyond the `hasDependents` contract change from `design/pg-isolation-levels.md`.
- Docs:
  - a MySQL/MariaDB integration page covering supported versions, provider requirements (UTC session, driver timezone, READ COMMITTED in `withTransaction`, no `multipleStatements`), isolation behavior by server and level, 1205 handling, schema and indexes, and the notify pairing;
  - `state-mysql-*` examples;
  - the installation page and comparison pages updated where they list databases.

## Tests

- **Conformance.** The state adapter conformance suite runs on MySQL 8.0, MySQL 8.4, MariaDB 10.11, MariaDB 11.4 and MariaDB 11.8, through the mysql2 and mariadb providers. Each example provider runs it on one server. This needs `acquireMysql` / `acquireMariadb` helpers in `@queuert/testcontainers`.
- **Races.** The races in [Isolation and locking](#isolation-and-locking), run at RC, RR and SERIALIZABLE on each server, and on 11.8 with snapshot isolation both ON and OFF. Each must end with the dependent `pending`, with retries where 1213 or 1020 is expected.
- **Load.** Concurrent fan-in and multi-blocker attach end with no stuck dependents, and `blockers_remaining` equals its recompute.
- **Processing suites with stricter user transactions.** They run with the session `transaction_isolation` at `REPEATABLE-READ` and at `SERIALIZABLE`. Queuert-owned transactions report `READ COMMITTED` in `information_schema.innodb_trx`.
- **Acquisition.** Concurrent claims are disjoint. A claim locks no more rows than it returns (`performance_schema.data_locks`). A producer `INSERT` does not wait on a drained-queue claim at RC.
- **Lease gate.** Renewal latency under continuous claims stays bounded, and a claim, a renewal and a reclaim of the same worker do not deadlock.
- **Correctness hazards.**
  - Dedup keys and type names that differ only in case, accent or trailing spaces are distinct.
  - Timestamps round-trip exactly with a non-UTC host time zone and a non-UTC server `time_zone`.
  - Booleans, counts and JSON payloads (including JSON `null` versus absent) normalize identically across drivers.
- **Migrations.**
  - Kill the process after each statement of `001`, rerun, and get the same schema.
  - Two processes migrating at once: one migrates, the other waits.
  - A migration behind an open reader transaction fails after `lock_wait_timeout` instead of hanging.
- **Benchmarks.** Add MySQL and MariaDB to the processing-capacity benchmark. Compare the per-type pick loop with `UNION ALL` picks for workers with 1, 4 and 16 type names. Run both servers with the same binlog and fsync settings: the spike's MySQL image had `sync_binlog=1` and its MariaDB image had binlog off, so the spike's cross-server numbers are not comparable.

## Open questions

- **Multi-statement round trips.** Sending a whole method as one multi-statement `query()` collapsed `startJobAttempts` and `createJobs` to one round trip _(spike)_. It is only safe on drivers that escape correctly under `NO_BACKSLASH_ESCAPES` (the mariadb connector) or that use the binary protocol, which rejects multi-statements. A possible opt-in is a provider capability flag. Defer until benchmarks show round trips dominate.
- **MariaDB `RETURNING` shortcuts** for `startWorker`, `stopWorker`, `deleteChains` and dedup-free `createJobs`: a 1-statement saving each. Phase 2, behind the dialect switch.
- **Compact ids.** `BINARY(16)` or MariaDB `UUID` columns halve id and index size, but need encode/decode SQL per dialect and return Buffers from mysql2. Revisit with the "numeric job and worker IDs" task.
- **Read replicas.** `readOnly` is passed through as in PostgreSQL. Replica lag means `getStartAttemptDelayMs` and dashboard reads can be stale. Document it; don't route by default.

## Related designs

- **PostgreSQL isolation levels** (`design/pg-isolation-levels.md`): a prerequisite. It supplies the `hasDependents` contract change and the counter semantics this adapter uses from its first migration. Implement it first.
- **Chain table** (`design/chain-table.md`): when chains move to their own table, this adapter follows in the same release. `has_dependents` moves to the chain row, and acquisition no longer locks a head row that attach also locks.
- **Unbounded blockers** (`design/unbounded-blockers.md`): its `job_blocker.blocked` flip must be a current-read write here as well.

## Spike

The scripts are in the session scratchpad, outside the repo:

- `spike-locking/`: races, fan-in load, acquisition lock footprint, throughput, and the InnoDB facts.
- `spike-dialect/`: the feature matrix, `JSON_TABLE` batching, index `EXPLAIN`s on 200k rows, types, migrations, and the provider prototypes for mysql2 Pool and Connection, mariadb Pool, Drizzle and Kysely.

The spike did not cover:

- MySQL < 8.0.46 and MariaDB 10.6 itself;
- Prisma;
- proxies and managed services;
- a full end-to-end adapter or conformance run;
- multi-job chains (`head_done`);
- the single-table `unblockJobs` shape;
- the lease-gate share lock.
