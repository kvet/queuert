# @queuert/sqlite

## 0.18.0

### Major Changes

- 8e6214a: `PgStateAdapter` and `SqliteStateAdapter` no longer have `truncate()`. It only existed to clear the tables between tests; run `TRUNCATE` or `DELETE` against the job, blocker and worker tables yourself. The provider conformance contexts still clear the tables before every case.
- 9358147: Worker runners no longer reschedule running jobs that hold no attempt token, which only a worker of a version before 0.17 claims. Upgrade from a version before 0.17 through 0.17 and let every process on the previous version stop before deploying this version, or a job such a process claims stays running.

  - `StateAdapter.listWorkerJobs` no longer accepts `workerId: null`; custom state adapters can drop the listing of running jobs without an attempt token.

- 0834205: Queuert now requires Node.js 24 or later. Node.js 22 is no longer supported; upgrade the runtime before upgrading Queuert.

  - The `engines.node` field of every package is now `>=24`.

- b1c0838: State providers own commit and rollback callbacks. `PgStateProvider`, `SqliteStateProvider` and `StateAdapter` require `onTransactionCommit(txCtx, callback)` and `onTransactionRollback(txCtx, callback)`, and the client and worker register their side effects only through them. A provider over an ORM with its own transaction events (such as MikroORM) implements them natively, so callers pass the transaction context alone; a provider without them carries `txHooks` in its transaction context, creates them in `withTransaction` with `withTxHooks`, and registers callbacks on them, so callers keep passing `txHooks`, now as a field of that context.

  - `txHooks` is no longer a separate option of `complete` and the client's mutating methods; whatever the provider's context type requires is required for mutating calls and optional for reads.
  - `fence` takes a partial transaction context, as reads do.
  - The `completeChain` handler's `completeJob` callback no longer receives `txHooks`; register side effects on the transaction context you passed.
  - `createPgStateProviderConformanceContext` and `createSqliteStateProviderConformanceContext` accept an optional `withSavepoint`; when given, the provider cases check that `onTransactionCommit` and `onTransactionRollback` follow savepoints.
  - `complete` succeeds once per attempt instead of once per `txHooks`: a second or concurrent call throws without aborting the attempt, and a call whose transaction rolled back can be retried in a new transaction.

- e4244e4: Code running against a newer schema can no longer corrupt state. The schema now carries an empty write fence table that every insert, update or delete of a job, blocker or worker references. A later breaking migration drops it, so writes from older processes fail with `SchemaFencedError` and change nothing. The migration history of `@queuert/postgres` and `@queuert/sqlite` is squashed into a single `001_schema_v1` migration at schema version 1. `migrateToLatest()` carries a 0.17 database onto it by adding the fence table and recording `001_schema_v1` next to the 0.17 records, without touching job or worker rows, so 0.17 processes keep running, and can restart and run their own `migrateToLatest()`, during the upgrade. 0.17 references no fence, so stop every 0.17 process before the first breaking migration.

  - New `SchemaFencedError`, thrown by every PostgreSQL and SQLite state adapter write once the schema fenced its code version; worker runners report it through `workerError`.
  - The schema adds a `{prefix}schema_fence_v1` table on PostgreSQL and SQLite.
  - `001_schema_v1` builds the whole schema in place of `001_initial_schema` and `002_worker_liveness`, which stay recorded on an upgraded 0.17 database. A 0.16 database is refused: upgrade it with 0.17 first.
  - `PgStateProvider` and `SqliteStateProvider` require `classifyError({ error })`, returning `{ kind: "undefined_table", tableName }` with the missing table's name for a missing-table error, and `undefined` otherwise or when the name cannot be read. Custom providers must implement it; `pgStateProviderConformanceCases` and `sqliteStateProviderConformanceCases` check it, along with the fence itself.

- bce5c32: Users with a SQLite driver that runs statements synchronously can call Queuert inside the driver's own synchronous transaction, such as `db.transaction(() => …)()`. The client follows its state adapter's mode: over a `StateAdapter` in the `"sync"` mode, `createClient` returns a client whose state-touching methods, workerless `completeChain`, and the attempt handler's `complete` and `fence` return plain values and throw synchronously, so an error rolls the transaction back. Over an async `StateAdapter` they return promises as before. `createProcessors`, `createWorkerRunner`, `withTxHooks` and `createTxHooks` are the same API in both modes.

  - `StateAdapter` and `NotifyAdapter` take a required mode parameter, so existing references must name it: `StateAdapter<TTxContext, TJobId, TWorkerId, "async">` and `NotifyAdapter<"async">` are the promise-returning adapters, `StateAdapter<TTxContext, TJobId, TWorkerId, "sync">` and `NotifyAdapter<"sync">` are adapters that set `sync: true`, close synchronously and are held with `using`, and `StateAdapter<any, any, any, "async" | "sync">` is an adapter of either mode; an async adapter leaves `sync` unset or `false`. Every method of an adapter with `sync: true` must return a plain value: one that returns a promise fails the call with an error. Also new in `queuert`: `PageParams`.
  - `createClient` takes a state adapter of either mode and types `Client`'s methods by it; over an async state adapter the notify adapter may be of either mode, while a sync state adapter takes only a sync notify adapter, and `createClient` throws otherwise; `awaitChain` returns a promise in both.
  - Over a synchronous client, the handlers of `createProcessors` get a synchronous `complete` and `fence`, and the worker runner keeps its async `start`, `stop`, `close` and `[Symbol.asyncDispose]`.
  - `withTxHooks` returns the callback's value and runs the commit callbacks synchronously when the callback returns a plain value, and throws after every commit callback has run if one of them returned a promise; `createTxHooks().flush()` returns a promise only when a commit callback returned one.
  - Attempt middleware passed to `createProcessors` must be typed for the client's state adapter: middleware typed for a different concrete state adapter is a compile error.
  - `createDashboard` accepts a client over a state adapter of either mode.
  - The conformance case lists in `queuert/conformance` run over an adapter of either mode, taking the mode from its `sync` marker. The cases only an async adapter can pass moved to their own lists, which an async adapter runs next to the base lists: `asyncStateAdapterConformanceCases` and `asyncStateAdapterEndToEndConformanceCases`, and `asyncSqliteStateProviderConformanceCases` in `@queuert/sqlite/conformance`.
  - `SqliteStateProvider` and `SqliteStateAdapter` in `@queuert/sqlite` take a mode parameter (`"async"` by default). `createSqliteStateAdapter` returns a `SqliteStateAdapter<…, "sync">` over a `SqliteStateProvider<…, "sync">`, which sets `sync: true`; a synchronous provider takes no lock, implements synchronous `onTransactionCommit` and `onTransactionRollback` (carrying `TxHooks` in its context when the driver has no transaction events), and its `executeSql` throws when a statement without `txCtx` finds the connection inside an open transaction.
  - `createSqliteStateAdapter` takes the provider type as its first type parameter instead of the transaction context type, so `createSqliteStateAdapter<TTxContext, TJobId>` becomes `createSqliteStateAdapter<typeof stateProvider, TJobId>`; `createSqliteMigrator` no longer takes a type parameter and infers everything from its `stateProvider`.
  - `Migrator`, `Migration` and `MigrationScript` in `@queuert/sqlite` take an optional mode parameter (`"async"` by default): `createSqliteMigrator` returns a `Migrator<"sync">` over a synchronous provider, which takes `Migration<TTxContext, "sync">` migrations and no lease.
  - `sqliteStateProviderConformanceCases` and `sqliteMigratorConformanceCases` in `@queuert/sqlite/conformance` run over a provider of either mode, adding the synchronous provider's own contract cases and passing the migrator's lease cases over a synchronous one. `createSqliteStateProviderConformanceContext` and `createSqliteMigratorConformanceContext` accept a synchronous provider, and the state provider context is returned directly for one.

- cf464c5: Every factory now returns its value synchronously instead of a promise, so a client, worker runner or adapter can be built at module top level or in a non-async context. `await` on the result keeps working.

  - Synchronous: `createClient`, `createWorkerRunner`, `createPgStateAdapter`, `createPgNotifyAdapter`, `createSqliteStateAdapter`, `createRedisNotifyAdapter`, `createNatsNotifyAdapter`, `createOtelObservabilityAdapter` and `createDashboard`.
  - Construction-time validation errors (invalid worker runner options, `InvalidWorkerIdError`, `DuplicateJobTypeError`, missing `requiredAttemptMiddleware`, invalid `schema`, `tablePrefix`, `jobIdType` or `workerIdType`) throw instead of rejecting.
  - `createX(...).then((x) => ...)` becomes `const x = createX(...)`, and `createX(...).catch(...)` becomes a `try` / `catch` around the call.
  - A `Promise<Client>` (or other `Promise<...>`) annotation on a factory result becomes `Client`, and `Awaited<ReturnType<typeof createX>>` can be simplified to `ReturnType<typeof createX>`.

### Minor Changes

- 8e6214a: State and notify adapters are async disposable: `[Symbol.asyncDispose]` calls `close()`, so an adapter can be held with `await using` and is closed when the scope ends. The `StateAdapter` and `NotifyAdapter` types require it, so a custom adapter must implement it, usually by pointing it at `close`.
- 1499392: The state provider conformance helpers take `stateAdapterOptions`, so the suite can run against the adapter configuration your application uses. Before, every helper built its adapter with the defaults, so it could not run against a database migrated with another schema, table prefix or ID type, and custom ID generators were never exercised.

  - `createPgStateProviderConformanceContext`, `createMysqlStateProviderConformanceContext` and `createSqliteStateProviderConformanceContext` take `stateAdapterOptions` (the adapter's options besides its provider, and `dialect` for MySQL), create every adapter with them, and migrate and clear the tables they name.
  - `createRedisStateProviderConformanceContext` takes `stateAdapterOptions` besides its provider and `keyPrefix`; each case still writes under a key prefix of its own.
  - The PostgreSQL and SQLite `classifyError` cases and the MySQL isolation-level case no longer read the `queuert_job` table.

- 68cb9eb: The conformance suites are lists of cases you run with your own test runner, one test per case, instead of runners that drive the whole suite inside a single test. Your test file owns the database or broker connections in its own hooks and registers a test for each case; `case.run(context)` resolves when the case passes and rejects when it fails. Each case creates its own adapter from the context's `createStateAdapter` and closes it when it ends; the provider helpers take a provider factory (`createStateProvider` or `createNotifyProvider`), build each case's adapter over a new provider from it, and clear the tables for every state case. This works the same under vitest, `node:test` and `bun:test`, and failures and filters show per case. The state adapter cases are split by what an adapter can do, and each adapter package ships cases for the providers you write for it, with a helper that migrates the schema and builds the adapters over providers from your factory.

  - `queuert/conformance`: `stateAdapterConformanceCases`, `concurrentStateAdapterConformanceCases`, `notifyAdapterConformanceCases` and `validationAdapterConformanceCases`, plus the `ConformanceTestCase` type.
  - `StateConformanceFixture` and `NotifyConformanceFixture` are renamed `StateAdapterConformanceContext` and `NotifyAdapterConformanceContext`.
  - The countCap case is no longer part of `stateAdapterConformanceCases`: it needs an adapter created with a small `countCap`.
  - `StateAdapterConformanceContext` takes `createStateAdapter` in place of `stateAdapter`, and `NotifyAdapterConformanceContext` takes `createNotifyAdapter` in place of `notifyAdapter`; the adapters a case creates are closed when it ends.
  - `withNonTransactionContext` is required on `StateAdapterConformanceContext` and on the PostgreSQL and SQLite provider context helpers, so the `isTransaction` case always runs.
  - Removed from `queuert/conformance`: `runStateAdapterConformance`, `runNotifyAdapterConformance`, `runValidationAdapterConformance`, `ConformanceError`, `ConformanceReport`, `ConformanceResult`, the conformance options types, `ValidationConformanceFixture` (use `ValidationAdapterConformanceContext`), and the contexts' `transactionConcurrency`, `dispose` and `reset` fields.
  - New `@queuert/postgres/conformance` with `pgStateProviderConformanceCases`, `createPgStateProviderConformanceContext`, `pgNotifyProviderConformanceCases` and `createPgNotifyProviderConformanceContext`.
  - New `@queuert/sqlite/conformance` with `sqliteStateProviderConformanceCases` and `createSqliteStateProviderConformanceContext`.
  - New `@queuert/redis/conformance` with `redisNotifyProviderConformanceCases` and `createRedisNotifyProviderConformanceContext`.

- 4f302a8: The migrator that runs Queuert's own schema is exported, experimentally, for your application's migrations: `createPgMigrator` and `createSqliteMigrator` keep the history in tables you name, run through your state provider, and let many processes migrate on boot at once ([#8](https://github.com/kvet/queuert/issues/8)). Migrations run in list order and can be reverted; each is an `up` and a `down` function that uses your own query builder inside the migration's transaction, or runs outside a transaction when the migration sets `type: "non-transactional"`.

  - New exports: `createPgMigrator` / `createSqliteMigrator` and the `Migration`, `MigrationScript` and `Migrator` types.
  - `down` is required: `migrateTo` uses it to revert, and a migration that cannot be reverted throws from it. `migrateTo(null)` reverts every applied migration.
  - Invalid lease timings throw a `TypeError` when the migrator is created; `heartbeatIntervalMs` must be below a third of `ttlMs`.
  - `MigrationResult` gains `reverted`.
  - A failing migration rejects with an error naming it, with the original error as `cause`.
  - With PostgreSQL, the state adapter's `migrateToLatest` no longer issues `CREATE TABLE IF NOT EXISTS` for its history and lease tables once they exist, so a boot against a migrated database logs no server notices, and a process can take over an expired lease while another process's migration transaction is still open.
  - `@queuert/postgres/conformance` and `@queuert/sqlite/conformance` export migrator conformance cases to run over your state provider.

- Queuert 0.18 can run synchronously inside your driver's own transaction. It adds experimental MySQL/MariaDB and Redis state adapters, a broker-free IPC notify adapter and a public migrator for your own migrations. Schema fencing protects state across upgrades, and the release reworks tx hooks, the worker runner, job type codecs and adapter conformance, with breaking API changes and a Node.js 24 minimum.

### Patch Changes

- 77e02a0: A `createChain` or `createChains` call that matches an existing multi-step chain through deduplication returns that chain's real output. Before, the PostgreSQL and SQLite adapters left the tail out of a deduplicated match, so a match against a completed chain that had continued reported the head job's empty output.

  - `createJobs` on the PostgreSQL and SQLite state adapters returns the latest continuation as `tail` for a deduplicated match, as `getChains` does.

- 9bffa41: New experimental package `@queuert/mysql`: a state adapter for MySQL 8.4+ and MariaDB 11.4+ (InnoDB), so chains and jobs commit in the same transactions as application data kept in either server. One adapter serves both servers through a required `dialect` option, and, as on PostgreSQL, Queuert supports READ COMMITTED only: its own transactions open at READ COMMITTED, and transactions you pass in must use it too. There is no notify adapter: pair it with the Redis or NATS notify adapter, or let workers poll.

  - `createMysqlStateAdapter({ stateProvider, dialect, schema?, tablePrefix?, jobIdType?, workerIdType?, … })` with the `MysqlStateAdapter` and `MysqlStateProvider` types; `jobIdType` and `workerIdType` take `"uuid"` or `"varchar(n)"`.
  - `migrateToLatest()` installs the schema with idempotent statements, so a run that stopped partway resumes.
  - Type names, deduplication keys and text ids use an exact NO PAD binary collation, and timestamps are stored as UTC `DATETIME(6)` whatever the server or session time zone.
  - `createMysqlMigrator` runs your application's own migrations with the same lease and history as `createPgMigrator`; DDL commits implicitly on MySQL and MariaDB, so schema changes belong in rerunnable `non-transactional` migrations.
  - `@queuert/mysql/conformance` exports `mysqlStateProviderConformanceCases`, `mysqlMigratorConformanceCases` and their context helpers to check a provider you write; the `state-mysql-mysql2` example is a reference provider for mysql2.
  - The migrator conformance cases gain one that checks a failing transactional migration rolls back its row writes, and the DDL rollback case moved into its own group, so stores whose servers commit DDL implicitly can run the rest; `pgMigratorConformanceCases` and `sqliteMigratorConformanceCases` include the new case.

- cb19191: Processing a job costs less CPU and allocates less memory: about 35–40% less CPU per job with the SQLite and PostgreSQL state adapters in the runtime performance benchmark.

  - Tx hooks and the adapter logging wrappers allocate less per transaction and per adapter call, and flushing tx hooks adds no extra await unless a commit callback returns a promise.
  - Notifications from transactions that commit at the same time are sent in one notify adapter call, with duplicate job types, chain ids and job ids removed.
  - A waiting worker wakes up through a plain timer, without creating an `AbortController`, `AbortSignal.any` and an abort `DOMException` on every wait.
  - With no `log` and no observability adapter configured, events are dropped before their payloads are built.
  - The PostgreSQL and SQLite state adapters build each query's parameter and column type maps once instead of on every query.
  - The SQLite state adapter claims jobs with a prepared statement that SQLite keeps, instead of one it re-parses and re-plans on every claim because of its bound `LIMIT`.
  - The SQLite state adapter skips unblocking dependent jobs with a single indexed check when no job is blocked by the completed chain, as the PostgreSQL adapter already does.

- 2755ba9: The SQLite adapter takes SQLite's write lock for chain, job and worker locks inside a transaction with one no-op write to the empty `{prefix}write_lock` table, the same way migration transactions do. The lock no longer looks up or rewrites the locked rows.

  - `getChains`, `getJobs` and `getWorkers` with `lock: "exclusive"` make that one no-op write before their read.

- 9e6c2b5: Functions that run in both synchronous and asynchronous mode now carry their real names in stack traces and CPU profiles, and a synchronous client or in-process state adapter given a callback that returns a promise reports it with one shared error message.

  - Compiled functions are named after the variable or property they belong to, such as `createChainSync` and `createChainAsync`, instead of `sync` and `async`.
  - A promise returned to a synchronous `completeChain` handler, `completeJob` callback or in-process `withTransaction` callback throws "A synchronous step got a promise: the value must be synchronous".

- Updated dependencies [8e6214a]
- Updated dependencies [5faa717]
- Updated dependencies [23481af]
- Updated dependencies [fa5f72e]
- Updated dependencies [9358147]
- Updated dependencies [77e02a0]
- Updated dependencies [bce5c32]
- Updated dependencies [aedda52]
- Updated dependencies [68cb9eb]
- Updated dependencies [0834205]
- Updated dependencies [9832912]
- Updated dependencies [b1c0838]
- Updated dependencies [6df6caf]
- Updated dependencies
- Updated dependencies [cb19191]
- Updated dependencies [e4244e4]
- Updated dependencies [9e6c2b5]
- Updated dependencies [bce5c32]
- Updated dependencies [cf464c5]
- Updated dependencies [747cd37]
- Updated dependencies [cf464c5]
  - queuert@0.18.0

## 0.17.0

### Major Changes

- 1a6d8c7: The type-name and per-key count methods on the client and the `StateAdapter` interface are renamed so `list*` always means a paginated method and each count names what it counts. Signatures and results are unchanged; rename the calls, and custom state adapters rename the methods they implement.

  - `listChainTypeNames` → `getChainTypeNames`, `listJobTypeNames` → `getJobTypeNames`.
  - `countByChainTypeNames` → `countChainsByTypeName`, `countByJobTypeNames` → `countJobsByTypeName`.
  - The `operation` reported on `state_adapter_error` logs and the `queuert.state_adapter.error` metric uses the new method names.

- 6bd65c1: Remove the one-step upgrade from a v0.15.1 database. `migrateToLatest()` no longer converts v0.15.1 job tables to the current schema, so a v0.15.1 database must first be upgraded with `@queuert/postgres` / `@queuert/sqlite` 0.16.x before moving to this version.
- 1a6d8c7: The state adapter options for job IDs now name the job explicitly, matching `InvalidJobIdError`.

  - `generateId` and `validateId` are renamed to `generateJobId` and `validateJobId`, as options of `createPgStateAdapter`, `createSqliteStateAdapter` and `createInProcessStateAdapter`.
  - The `idType` option of `createPgStateAdapter` and `createSqliteStateAdapter` is renamed to `jobIdType`.

- 4327b34: The in-process worker acquires jobs in batches sized to its idle slots, so filling `N` slots costs one database round-trip instead of `N`, and throughput at higher `concurrency` is no longer capped by the latency of a single acquisition. Custom state adapters must implement the batched methods.

  - `StateAdapter.startJobAttempt` is replaced by `startJobAttempts`, which takes a `limit` and returns an array of up to `limit` acquired jobs.

- Queuert 0.17 moves job completion into your own database transactions and replaces per-job attempt leases with a worker registry, so ownership is fenced end to end. It also batches acquisition and notifications to cut database and broker round trips. This is a breaking release: read the migration notes before upgrading, and run the `002_worker_liveness` migration.
- cfdc0f4: State adapters now expose their configuration as `stateAdapter.config`, and core uses it to generate and validate job IDs and enforce the blocker limit before anything is written. The per-job blocker limit and the per-status count cap are no longer hardcoded, and `transactionConcurrency` moves out of the adapter contract into the conformance fixture, since nothing at runtime used it. Defaults are unchanged, so existing setups behave the same.

  - New `maxBlockersPerJob` (default `100`) and `countCap` (default `10_000`) options on `createPgStateAdapter`, `createSqliteStateAdapter`, and `createInProcessStateAdapter`; non-positive or non-integer values throw at creation.
  - `StateAdapter` gains a required `config: StateAdapterConfig` (`generateJobId`, `validateJobId`, `maxBlockersPerJob`, `countCap`), exported from `queuert`; custom state adapters must provide it.
  - `validateJobId` now runs in core on caller-supplied and generated IDs, throwing `InvalidJobIdError` before any write; `id` is now required on every job passed to `StateAdapter.createJobs` and `continueJobs`, and adapters no longer generate or validate IDs.
  - Removed `transactionConcurrency` from `StateAdapter`, `PgStateProvider`, and `SqliteStateProvider`; delete it from custom providers and adapters.
  - `runStateAdapterConformance` fixtures now require `transactionConcurrency: "concurrent" | "serialized"` (`"serialized"` skips the concurrent-transaction cases) and no longer take `generateId` or `generateInvalidId`.

- d6e1c62: Mutating client methods now reject a transaction context that is not inside an open transaction. Previously, passing a pool, the root ORM handle, or an idle connection where the transaction belonged was accepted: each statement of a multi-statement write committed on its own, so a failure partway could leave a job completed with its dependents still blocked, and `lock: "exclusive"` locks were released immediately, reopening the blocker-attach race. The check reads the driver's own transaction state synchronously and adds no database round trip.

  - `PgStateProvider` and `SqliteStateProvider` gain a required `isTransaction(txCtx)` method; custom providers must implement it from the driver's state (e.g. Kysely `db.isTransaction`, Knex `trx.isTransaction`, pg `client.getTransactionStatus()`, better-sqlite3 `db.inTransaction`, node:sqlite `db.isTransaction`).
  - `StateAdapter` gains a required `isTransaction(txCtx)` method; the built-in adapters forward it to the provider.
  - `createChain`, `createChains`, `completeChain`, `deleteChain(s)` and `rescheduleJob(s)` throw when the adapter reports the context as outside a transaction.
  - The state adapter conformance suite checks `isTransaction` and accepts an optional `withNonTransactionContext` fixture to verify the negative case.

- ce2bfff: Job processing runs in your own transaction. The handler does its work, opens a transaction with your database client, calls `complete({ ...txCtx, transactionHooks, output | continueWith | reschedule })` inside it and returns the result, so the outcome commits or rolls back together with your domain writes. Move the work from `prepare` and the old `complete` callback into your own transaction; the worker's own bookkeeping runs as atomic writes conditional on the attempt still owning the job.

  - Removed `prepare`, `step`, the old `complete` callback, the atomic and staged processing modes and auto-setup; `AttemptMiddleware` keeps only `wrapHandler`, which is required and returns `next`'s result.
  - `complete` (formerly `finish`) requires the transaction context and `transactionHooks`, throws `JobTakenByAnotherWorkerError`, `JobAlreadyCompletedError` or `JobNotFoundError` when the attempt no longer owns the job, and succeeds at most once per `transactionHooks` (open `withTransactionHooks` outside your transaction, once per try); wrap a `complete` that may be rolled back to a savepoint in `transactionHooks.withSavepoint`.
  - A handler that returns without a committed `complete` is rescheduled with backoff; an error thrown after a committed `complete` is reported as a `workerError` and keeps the completion.
  - Rescheduling after a failed attempt notifies workers like every other reschedule.
  - PostgreSQL: job acquisition locks only the job row, so a transaction holding a chain's head does not hold back its later jobs.
  - SQLite: every transaction you pass to `complete` or to client methods must be serialized with the provider's own transactions, for example by holding its `AsyncRwLock` write lock.
  - `@queuert/otel`: each attempt is a single span; the `prepare`, `step` and `complete` child spans and the `queuert.step.index`, `queuert.rescheduled_at` and `queuert.rescheduled_after_ms` attributes are removed (use the `queuert.job.rescheduled` metric).
  - Custom observability adapters, state providers and state adapters: the attempt span handle drops `startPrepare` and `startComplete`, `withSavepoint` is removed from the providers and `StateAdapter`, `completeJobs` drops `hasBlockedJobs`, and `startJobAttempts` and `rescheduleJobs` must work without a `txCtx`.
  - Workerless completion renames its callback argument the same way: `completeJob(job, async ({ complete }) => complete({ output }))`.
  - The `chain_created` and `job_created` logs and events report the parsed input (the stored `job.input`).

- 1a6d8c7: The attempt lease moves from jobs to workers. Each in-process worker registers a row in a new `worker` table with a lease that one heartbeat renews (`createInProcessWorker({ leaseConfig: { durationMs, heartbeatMs } })`, defaults 60s / 15s), and a running job is live exactly while its worker's lease is live. A worker that loses its lease aborts its attempts and registers again; an idle worker reclaims expired workers' running jobs as failed attempts with no backoff. The `002_worker_liveness` migration creates the `worker` table, adds `job.attempt_token`, drops `job.attempt_until` and returns every running job to pending. Processes on the previous version can keep running while new ones deploy: they still create chains, but an attempt they run fails to complete, and an upgraded worker reschedules a job they claimed, without an attempt token, once its attempt is older than `leaseConfig.durationMs`, so the job runs again. On PostgreSQL the migration gives up after 5s if it cannot take its locks, instead of waiting behind old processes.

  - Removed `attemptConfig`, `AttemptConfig`, the `defaults` option of `createInProcessWorker`, `InProcessWorkerDefaults`, `Job.attemptUntil` and the unused `RetryConfig` type; `createInProcessWorker` takes a top-level `backoffConfig` fallback, and `WorkerLeaseConfig` is exported.
  - The `workerName` option is replaced by `workerId`, defaulting to the state adapter's new `generateWorkerId` and checked with `validateWorkerId` (throwing the new `InvalidWorkerIdError`); two in-process workers with the same id never run at once, reported through the new `WorkerAlreadyLiveError` and `WorkerLeaseLostError`.
  - `start()` registers the worker in the background, and throws when called again before its `stop` resolved; `stop()` reschedules the worker's running jobs and deletes its row; `recoveryBackoffConfig` covers failed registrations, loop errors and restarts.
  - Attempt-scoped writes carry an attempt token, so a stale attempt's `complete` writes nothing and throws.
  - An idle worker reclaims one expired worker at a time, picked at random among the oldest eight, and reschedules its own running jobs that no attempt runs after an error and otherwise at most once per `leaseConfig.heartbeatMs`.
  - A reclaimed job records a serialized `JobAttemptReclaimedError` (new export) as its last attempt error and emits `jobRescheduled`; `jobAttemptReclaimed` carries `reclaimedFrom`, and `workerLeaseLost` is added with the `queuert.worker.lease_lost` metric.
  - `createPgStateAdapter` and `createSqliteStateAdapter` take a `workerIdType` option; on PostgreSQL the migration recreates `job.attempt_by` and `job.completed_by` with that type, clearing stored worker IDs, while SQLite keeps them.
  - `StateAdapter`, `StateAdapterConfig`, `PgStateAdapter`, `SqliteStateAdapter` and `Job` gain a `TWorkerId` type parameter right after `TJobId`, shifting the later parameters by one.
  - PostgreSQL compares schedules and leases against the statement's time rather than the transaction's start.
  - `Worker` is exported and the client gains `getWorker`, `getWorkers`, `countWorkers`, `countWorkersByTypeName`, `countRunningJobsByWorkerId`, `listWorkers` and `listWorkerJobs`.
  - Custom state adapters implement the new worker methods and attempt-token checks, list the running jobs that hold no attempt token for `listWorkerJobs({ workerId: null })`, and drop `extendJobAttempt` and `reclaimExpiredJobAttempts`; the [state adapter interface](https://kvet.github.io/queuert/integrations/state-adapters/#the-stateadapter-interface) lists the contract.
  - The dashboard adds Workers pages, links a running job's worker, warns about workers that lost their lease and job types with no live worker, and drops the "Deadline" sort.

### Patch Changes

- 3b1cef4: Concurrent `migrateToLatest()` runs, such as several app instances deploying at once, now apply each migration exactly once (fixes [#7](https://github.com/kvet/queuert/issues/7)). On Postgres, a run whose migration lease was taken over (or taken over and released) by another process could silently re-claim it and re-run migrations that process had already applied, and a heartbeat still in flight at shutdown could leave a fresh lease behind that made other instances wait out its TTL. On SQLite, concurrent runs could each apply the same migration, and a second process migrating the same file failed with `database is locked`.

  - Postgres: the lease is fenced by owner id; a run that loses it aborts before its next migration step and never re-claims it.
  - Postgres: heartbeats run one at a time, and the lease is released only after any in-flight heartbeat settles.
  - Postgres: every migration transaction takes a transaction-scoped advisory lock first, so a deployment that took over a stalled run's lease waits for that run's open migration instead of failing with a duplicate-object error.
  - Transactional migrations re-check the migration table inside their own transaction and report a migration another run applied first as skipped.
  - SQLite: `migrateToLatest()` creates an empty `{tablePrefix}write_lock` table, and every migration transaction takes SQLite's write lock up front through it, so other processes wait for the lock (up to the connection's busy timeout) instead of failing.

- Updated dependencies [51fa015]
- Updated dependencies [7a80970]
- Updated dependencies [690c5cf]
- Updated dependencies [8586b33]
- Updated dependencies [1a6d8c7]
- Updated dependencies [6f3903d]
- Updated dependencies [1a6d8c7]
- Updated dependencies [ed1c13b]
- Updated dependencies [4327b34]
- Updated dependencies [488a10a]
- Updated dependencies [88e70f4]
- Updated dependencies
- Updated dependencies [bc5cc1a]
- Updated dependencies [cfdc0f4]
- Updated dependencies [d6e1c62]
- Updated dependencies [ce2bfff]
- Updated dependencies [1a6d8c7]
  - queuert@0.17.0

## 0.16.0

### Major Changes

- 24ff428: Rework the attempt's `complete` phase into a callback that decides the outcome via `finish`. The outcome is a plain object — `{ output }` or `{ continueWith: { typeName, input, ... } }`. `finish` writes before it returns, so code after it observes the committed state within the same transaction.

  - Migrate `complete(async () => output)` → `complete(async ({ finish }) => finish({ output }))`.
  - Migrate `complete(async ({ continueWith }) => continueWith(x))` → `complete(async ({ finish }) => finish({ continueWith: x }))`.
  - `finish({ output })` returns the completed job; `finish({ continueWith })` returns the completed job with the new job on `continuedTo`.
  - `client.completeChain`'s `complete` option is renamed `handler`, and the function it receives is renamed `completeJob` to distinguish it from the worker's `complete` (which finishes the current job and takes no job argument). `completeJob(job, callback)` uses the same `finish` vocabulary and unwraps whatever the callback returns: return the `finish({ continueWith })` result and you get the continuation back, so a handler can walk several jobs with `job = await completeJob(job, ...)`; a `finish({ output })` result resolves to the completed job.
  - The `prepare`, `step` and `complete` spans now record the exception and report `ERROR` status when the phase throws, and the `complete` span is no longer left unended when it does.
  - The CONSUMER span emitted when a blocker chain completes is renamed from `resolve chain.{type}` to `complete chain.{type}`; update trace queries and alerts that match `resolve chain.*`.

- 24ff428: Remove `excludeChainIds` from `DeduplicationOptions`. It existed for exactly one reason: a recurring chain self-scheduling its next occurrence under `scope: "running"` matched the chain it was completing, because the completion write had not happened yet when the handler ran. The attempt finalization rework removes that ordering — `finish({ output })` and `finish({ continueWith })` write their transition before returning — so a `createChain` placed after the terminal action already sees the chain as completed and cannot match it. Move the scheduling call after `finish(...)` and drop the option; nothing is persisted for it, so no migration is needed. Scheduling the next occurrence from a mid-chain job, or before the terminal action, now matches the still-running chain and suppresses the occurrence — use `scope: "any"` or schedule from the terminal job instead.

  - `deduplication.excludeChainIds` is no longer accepted by `createChain` / `createChains`.
  - `DeduplicationOptions` loses its type parameter — write `DeduplicationOptions`, not `DeduplicationOptions<string>`.
  - The "Excluding Chains" section of the deduplication guide is replaced by "Self-Scheduling Recurring Chains", which documents the complete-then-schedule ordering; the cleanup and scheduling guides and the `showcase-scheduling` / `showcase-cleanup` examples follow the same shape.

- dc5a2b8: Remove `windowMs` from `DeduplicationOptions`. It was throttling wearing deduplication's clothes, and lossy throttling at that: a suppressed call reported `deduplicated: true` against a chain that may have completed long ago with different input, so the caller could not tell "already queued" from "dropped". Deduplication now matches on `key` and `scope` alone. There is no replacement — if you need rate limiting, do the time check on your side before calling `createChain`, or use an `any`-scoped key together with a retention policy that deletes old chains. Nothing is persisted for `windowMs`, so no migration is needed.

  - `deduplication.windowMs` is no longer accepted by `createChain` / `createChains` (a type error; the option is ignored at runtime).
  - The "Time-Windowed Deduplication" section is gone from the deduplication guide, and the `showcase-scheduling` example drops its rate-limiting scenario.

- 7cb4d94: Caller-supplied `id` on `createChain`/`createChains`/`continueWith` is now assignment-only with a hard error on collision. Previously, PostgreSQL and SQLite silently returned the existing row (with `deduplicated: false`), and the in-process adapter silently overwrote it. Now all three adapters reject a duplicate `id` — SQL adapters surface the raw constraint violation, in-process throws before writing. Deduplication is unaffected and stays exclusively with the `deduplication` option.

  - A caller-supplied `id` that collides with an existing job now errors instead of being silently swallowed.
  - Intra-batch duplicate `id` values in a single `createChains` call error (raw database constraint on SQL adapters).
  - Generated id collisions from a misconfigured `generateId` also error — `generateId` must return unique values.
  - `id` remains optional; when omitted, `generateId()` produces the id as before.

- da06e7d: Redesign the job model around the head row: a chain's head row _is_ the chain, and the chain's own facts — type name, status, deduplication key, trace context and completion time — live on that row and are written when the chain ends rather than inferred from its latest job. This is a breaking schema change that replaces the job tables: the database must already be at v0.15.1. On PostgreSQL, `migrateToLatest()` copies the tables while v0.15.1 workers keep running and blocks them only for a final swap that verifies the copy, which takes roughly a second per million jobs; on SQLite, all workers and clients must be stopped while it runs.

  - `ChainStatus` drops `"blocked"` and `"pending"`, leaving `"running" | "completed"`; a chain is running until its tail job completes terminally, and only the `completed` variant of `Chain` carries `output` and `completedAt`. Job status is unchanged (`blocked` stays a job status).
  - Completed jobs carry `continuedToId`: `null` with `output` when the job ended its chain, the successor's id (and no `output`) when it continued.
  - The running `Job` variant replaces the optional `leasedBy` / `leasedUntil` with `attemptAt` (when the current attempt started), `attemptBy` and `attemptUntil`.
  - Lease terminology becomes attempt terminology: `leaseConfig` → `attemptConfig` on processors and worker defaults (`leaseMs` → `timeoutMs`, `renewIntervalMs` → `heartbeatMs`; type `LeaseConfig` → `AttemptConfig`); log events `job_attempt_lease_expired` / `job_attempt_lease_renewed` / `job_reaped` → `job_attempt_expired` / `job_attempt_extended` / `job_attempt_reclaimed`; OTEL metrics `queuert.job.attempt.lease_expired` / `queuert.job.attempt.lease_renewed` / `queuert.job.reaped` → `queuert.job.attempt.expired` / `queuert.job.attempt.extended` / `queuert.job.attempt.reclaimed`.
  - `listChains`, `listJobs` and `listChainJobs` take flat options with a single `status` string instead of a `filter` object with arrays, and `orderBy` is status-dependent and checked at compile time (e.g. running jobs by `attemptAt` or `attemptUntil`, completed jobs and chains by `completedAt`). `root` is renamed `independent` on `listChains`, `listChainJobs` takes `chainTypeName` instead of `typeName`, its cursors are opaque, and `CreatedAtCursor` is renamed `TimestampWithIdCursor`.
  - Deduplication `scope` is now required, and `"incomplete"` is renamed `"running"`; a missing `scope` (previously defaulting to `"incomplete"`) or an unknown one now throws a `TypeError` at runtime.
  - Fix a race where a job created with `blockers` while a blocker chain was being continued in another transaction started as `pending` instead of `blocked`; the blocker check now reads the chain's status from its locked head row ([#4](https://github.com/kvet/queuert/issues/4)).
  - The dashboard follows the model: the chain status filter offers only running and completed.
  - Concurrent `migrateToLatest()` calls are safe across processes: PostgreSQL serializes them through a new single-row `{tablePrefix}migration_lock` table (SQLite relies on its single writer).
  - The migration history collapses to a single `001_initial_schema` migration that fresh installs and upgrades run alike; the 0.15.x records are removed from `{tablePrefix}migration`, and on PostgreSQL the `{tablePrefix}job_status` enum is dropped.
  - Schema: the job table is rebuilt with chain facts on the head row (`chain_status`, `chain_completed_at`, `chain_deduplication_key`), `continued_to_id` and `attempt_at` added, `leased_*` renamed `attempt_*`, `status` as `text` with a CHECK constraint, and job/blocker foreign keys dropped; indexes are replaced by one partial index per status. See the PostgreSQL and SQLite internals docs for the full layout.

- 23ed227: Anchor every listing query to a single type so it can use a type-specific index, and add type discovery so callers (and the dashboard) can find which types to list. `listChains` and `listJobs` now require a single `typeName` string instead of accepting an optional array.

  - Add `client.listChainTypeNames()` and `client.listJobTypeNames()`, which return a sorted array of the distinct chain and job type names present in the store.
  - Add `client.countByChainTypeNames()` and `client.countByJobTypeNames()` for per-status counts of the given type names, each capped with a `hasMore` flag.
  - **Breaking:** `listChains` and `listJobs` require `typeName: string`; the `chainId` and `jobId` filters are removed from both, and `chainTypeName` is removed from `listJobs` — use `listChainJobs({ chainId })` to read the jobs of a specific chain and `getJob`/`getJobs` to fetch jobs by id.

- 63e0378: Remove the `cascade` option from `deleteChains` and `deleteChain`. Cascade deletion, which expanded the requested chains to include the blocker chains they transitively depend on, is no longer supported: callers that relied on `cascade: true` must enumerate the chains to delete explicitly. Collect a chain's blocker chains with `getJobBlockers` and pass them in the same `deleteChains` call as the chain that depends on them (or delete the dependent chain first); deleting a chain that is still a blocker for a job outside the deleted set fails with `BlockerReferenceError` and deletes nothing.

  - `deleteChains({ cascade })` and `deleteChain({ cascade })` are no longer accepted.
  - The dashboard's delete dialog loses its cascade checkbox and `DELETE /api/chains/:id` no longer honors `?cascade=true`.

- 63e0378: Remove `vacuum()` from both state adapters and drop the SQLite pragma guards. `migrateToLatest()` no longer inspects `PRAGMA foreign_keys` or `PRAGMA auto_vacuum`, and the `checkForeignKeys` and `checkAutoVacuum` options are gone — the SQLite adapter now runs on any database, whatever its pragma settings.

  - `vacuum()` is no longer exposed by `createSqliteStateAdapter()` or `createPgStateAdapter()`; remove the call from cleanup jobs. Space freed by deletions is reused by both engines without it.
  - `checkForeignKeys` and `checkAutoVacuum` are no longer accepted; remove them from `createSqliteStateAdapter()` calls.
  - `PRAGMA foreign_keys = ON` and `PRAGMA auto_vacuum = INCREMENTAL` are no longer needed on your connections.
  - To shrink a database file or rewrite a bloated table, run `VACUUM` (PostgreSQL: `VACUUM FULL`) yourself, out of band — both take heavy locks and are not something a cleanup job should do on every pass.

- c2a4fe0: Add `finish({ reschedule })` as a non-error rescheduling outcome for attempt handlers and delete the `rescheduleJob()` helper exported from `queuert` together with `RescheduleJobError`. A requested reschedule no longer travels the error path — it skips `lastAttemptError`, does not emit `jobAttemptFailed`, and the attempt span ends `ok`.

  - `finish({ reschedule: { afterMs } })` or `finish({ reschedule: { at } })` returns the job to pending as a first-class outcome alongside `{ output }` and `{ continueWith }`.
  - The top-level `rescheduleJob()` helper (called inside an attempt handler, where it throws) and `RescheduleJobError` are removed from the public API. Migrate: `rescheduleJob({ afterMs })` → `return complete(async ({ finish }) => finish({ reschedule: { afterMs } }))`.
  - The attempt span no longer sets the `queuert.attempt.result` attribute; read the outcome from the span status instead (`ERROR` for a failed attempt, `OK` for a completed, continued or rescheduled one).
  - The `queuert.job.completed` metric no longer carries `queuert.worker.id`; use `queuert.job.attempt.completed` for per-worker breakdowns.

### Minor Changes

- Queuert 0.16 rebuilds the job model around the chain's head row and reworks attempt handling around a single `finish` outcome API, with a one-step schema migration from v0.15.1. It also brings faster listing queries, a redesigned dashboard, and a leaner, more consistent public API. This release contains many breaking changes — review the upgrade notes before migrating.

### Patch Changes

- fffc0b3: Drop the `RELEASE SAVEPOINT` round-trip from the built-in savepoint fallback used by the PostgreSQL and SQLite state adapters. A successful savepoint is now simply left open — the surrounding `COMMIT` discards outstanding savepoints anyway — which removes one statement per `prepare` and per `complete` phase of every job attempt. Rollback behaviour is unchanged, and savepoint names stay unique per call so nested savepoints still roll back independently.
- Updated dependencies [0719785]
- Updated dependencies [09f353d]
- Updated dependencies [24ff428]
- Updated dependencies [a44004b]
- Updated dependencies [a1e6c1a]
- Updated dependencies [67833e1]
- Updated dependencies [24ff428]
- Updated dependencies [dc5a2b8]
- Updated dependencies [e7dd362]
- Updated dependencies [314fe95]
- Updated dependencies [7cb4d94]
- Updated dependencies [da06e7d]
- Updated dependencies [23ed227]
- Updated dependencies
- Updated dependencies [63e0378]
- Updated dependencies [c2a4fe0]
- Updated dependencies [24ff428]
- Updated dependencies [ca681b1]
- Updated dependencies [63aa316]
  - queuert@0.16.0

## 0.15.1

### Patch Changes

- f7194ab: Fix a worker busy-loop and make Postgres job acquisition use the acquisition index. A worker whose slots were all busy kept polling the state adapter as fast as the event loop allowed: with a due job in the backlog the poll reported `0ms`, so the wait returned immediately and the worker re-entered the loop without being able to take work. Saturated workers now wait for a slot to free instead of polling. Separately, the Postgres `acquireJob` and `getNextJobAvailableInMs` queries matched jobs with `type_name IN (...)` and ordered by `scheduled_at`, which Postgres cannot satisfy from the `(type_name, scheduled_at)` acquisition index for more than one job type — it fell back to scanning and sorting the entire pending backlog on every acquisition and every poll. Both queries now look up each job type separately so the index is used, turning a scan of the backlog into one index lookup per job type. Workers polling a large Postgres backlog should see a substantial drop in database load.
  - Saturated in-process workers no longer poll `getNextJobAvailableInMs`; they wake when a slot frees or after `pollIntervalMs`
  - Postgres `acquireJob` / `getNextJobAvailableInMs` rewritten as per-job-type `LATERAL` lookups
  - On Postgres, when several job types are polled together, acquisition now picks a job type at random and takes its oldest due job, rather than always taking the globally oldest job; this keeps a backlogged job type from starving the others
  - Postgres `getNextJobAvailableInMs` no longer takes row locks on jobs scheduled in the future

- Updated dependencies [f7194ab]
  - queuert@0.15.1

## 0.15.0

### Major Changes

- 02b2167: Rename the client `triggerJob` / `triggerJobs` methods to `rescheduleJob` / `rescheduleJobs`, add an optional `schedule` param, introduce strict batch errors, and make breaking provider changes. No DB migration.
  - `client.triggerJob` → `client.rescheduleJob` and `client.triggerJobs` → `client.rescheduleJobs`. Both now accept an optional `schedule: { at: Date } | { afterMs: number }`; omitting it reschedules to now (the previous behavior) and a past time clamps to now, matching `startChain`. Only `pending` jobs are reschedulable, and batch validation stays atomic.
  - The error classes `JobNotTriggerableError` / `JobsNotTriggerableError` are renamed to `JobNotReschedulableError` / `JobsNotReschedulableError`. New batch error variants `JobsNotFoundError` and `JobsNotReschedulableError` are thrown by `client.rescheduleJobs` when one or more inputs are missing or not pending. The `status` property has been removed from `JobNotReschedulableError`; the batch variant exposes offending ids via `jobIds`.
  - The observability event `jobTriggered` is renamed to `jobRescheduled`; the OpenTelemetry counter `queuert.job.triggered` becomes `queuert.job.rescheduled` and the structured log entry `job_triggered` becomes `job_rescheduled`.
  - `jobRescheduled` is now also emitted by the worker retry path (after a failed attempt is rescheduled), not just by client reschedules, making it the single signal for "a job's `scheduledAt` changed." It carries the resolved `scheduledAt` — the value actually stored. Correspondingly, `jobAttemptFailed` is now a pure failure event — the previous `rescheduledAt` / `rescheduledAfterMs` fields are removed from it (and from the `job_attempt_failed` log entry); observability-adapter authors should read `scheduledAt` from `jobRescheduled` instead.
  - Both `jobCreated` and `jobRescheduled` now report the resolved `scheduledAt` (the absolute value stored after clamping a past time to now) and nothing else schedule-related. The redundant `scheduleAfterMs` field is dropped from both events and their log entries.
  - `StateProvider` (both `@queuert/postgres` and `@queuert/sqlite`) gains a required `transactionConcurrency: "concurrent" | "serialized"` field that reports whether two `withTransaction` callbacks can run in flight at once. Custom providers must declare it — use `"concurrent"` for connection-pool backed providers (pg, postgres-js, Drizzle, Kysely, Prisma over pg) and `"serialized"` for single-handle SQLite drivers.

### Minor Changes

- af22109: A job can now reference the same blocker chain more than once. The `job_blocker` primary key is widened from `(job_id, blocked_by_chain_id)` to `(job_id, blocked_by_chain_id, index)` via a new migration so duplicate chain IDs at different positions are stored faithfully. The Postgres adapter also takes row-level locks on blocked jobs (ordered by id to prevent deadlocks) when evaluating concurrent blocker completions, preventing a race that could leave dependent jobs stranded in `blocked` status.

### Patch Changes

- 082650f: Fixed `"incomplete"` deduplication scope to correctly match multi-step chains that have continued past the root job. Previously, the lookup checked the root job's status directly — once the root completed (to continue to step 2), the chain was no longer matched, even though it was still running. The fix checks whether the chain's last job is completed instead.
- Updated dependencies [f5b7f9d]
- Updated dependencies [af22109]
- Updated dependencies [082650f]
- Updated dependencies [02b2167]
  - queuert@0.15.0

## 0.14.1

### Patch Changes

- ee13b9a: Conformance fixture cleanup. `StateConformanceFixture` now propagates `generateId` and `generateInvalidId` through to the cases — previously the runner only forwarded `stateAdapter` and `poisonTransaction`, so adapters configured with a custom `validateId` could not exercise the caller-supplied `id` path. As part of the fix, the separate `StateAdapterConformanceContext` and `NotifyAdapterConformanceContext` types were collapsed into `StateConformanceFixture` / `NotifyConformanceFixture` so a future field addition cannot be silently dropped at the fixture↔context bridge.
  - Added `generateId?: () => string` and `generateInvalidId?: () => string` to `StateConformanceFixture`; `runStateAdapterConformance` now forwards them.
  - Removed `StateAdapterConformanceContext` and `NotifyAdapterConformanceContext`. Callers that referenced these types (e.g. `it.extend<NotifyAdapterConformanceContext>(...)` in vitest specs) should switch to `StateConformanceFixture` / `NotifyConformanceFixture`.

- Updated dependencies [ee13b9a]
  - queuert@0.14.1

## 0.14.0

### Minor Changes

- 66a3c9c: Allow callers to assign job IDs and validate them adapter-side. `startChain`, `startChains`, and the worker `continueWith` callback now accept an optional `id` that becomes the new chain root (or continuation) job ID. State adapters accept a new `validateId` predicate that runs on both adapter-generated and caller-supplied IDs; failures throw the new `InvalidJobIdError`. When deduplication fires, the existing row's ID wins over a caller-supplied `id` (the returned chain carries `deduplicated: true`).

  Adapter ID-generation options are now aligned: both PostgreSQL and SQLite adapters expose a `generateId` function (renamed from `idGenerator` on SQLite; replacing the SQL `idDefault` option on PostgreSQL). The PostgreSQL adapter switches from server-side default expressions to JS-side ID generation, and a new migration drops `DEFAULT gen_random_uuid()` from the `id` column. Existing UUID generation behavior is unchanged for default configurations.
  - PostgreSQL: replace `idDefault: "gen_random_uuid()"` with `generateId: () => crypto.randomUUID()` (this is the default and can be omitted).
  - PostgreSQL: replace `idDefault: "'job.' || gen_random_uuid()::text"` with `generateId: () => \`job.${crypto.randomUUID()}\``.
  - SQLite: rename `idGenerator` option to `generateId`.
  - Custom state adapter implementations must accept an optional `id` per entry in `createJobs` and apply their own `validateId` predicate.

- 0fd8d55: `scheduled_at` is now the honest "earliest moment eligible" floor: state adapters clamp it to `MAX(requested, now())` on `createJobs`, `rescheduleJob`, and `unblockJobs`. Previously, jobs with a user-supplied past `scheduled_at` (or blocked-since-creation jobs whose original `scheduled_at` went stale while they waited) would jump to the front of the acquisition queue ahead of jobs that genuinely became ready earlier. Behavior change for `unblockJobs`: it previously reset `scheduled_at` to `now()` unconditionally; it now preserves a future `scheduled_at` set at job creation (the clamp picks the later of the two), so an intended future delay survives a blocker round-trip. `triggerJobs` continues to reset to `now()` as an explicit re-anchor. Applies to the PostgreSQL, SQLite, and in-process adapters; no schema migration or backfill required.

### Patch Changes

- 956bbd3: Clear `lastAttemptError` when a job completes successfully. Previously, if a job failed an attempt and then succeeded on a retry, the completed row retained the error string from the prior failed attempt, making completed jobs appear to have errored. `completeJob` now resets `last_attempt_error` to `NULL` in the PostgreSQL, SQLite, and in-process adapters alongside the existing status/output/lease updates.
- Updated dependencies [66a3c9c]
- Updated dependencies [956bbd3]
- Updated dependencies [3da743c]
- Updated dependencies [0fd8d55]
- Updated dependencies [673d669]
  - queuert@0.14.0

## 0.13.0

### Minor Changes

- Add worker-level defaults and required cross-slice middleware, restore composition of multiple external slices for validation adapters, tighten public error class fields, align `@queuert/otel` metric attributes with OpenTelemetry semantic conventions, and make `executeSql.id` uniquely identify the resolved SQL so custom state providers can cache prepared statements by id alone.

  **Features:**
  - `createInProcessWorker`: new `defaults: { backoffConfig?, leaseConfig? }` option for fleet-wide fallbacks (resolution: processor → registry → worker `defaults` → library default), plus `InProcessWorkerDefaults` exported from the package root.
  - `createInProcessWorker`: new `requiredAttemptMiddleware` tuple enforces (at compile time against the merged slice middleware, and at runtime by reference identity) that every slice includes the listed `AttemptMiddleware` instances as an in-order subsequence. The worker does not execute them itself — this guarantees cross-cutting concerns (auth, tracing, logging) are wired into every slice without giving up the per-slice middleware model.
  - Validation adapters now accept either a single external slice or a `readonly` array, restoring the multi-slice composition path that was removed alongside `mergeJobTypeRegistries` in 0.12. New public `JobTypesDefinitions<T>` resolves either form to the merged `BaseJobTypeDefinitions` record.
  - `@queuert/postgres` and `@queuert/sqlite` re-export `RuntimeType` so custom state-provider authors can type their serialization/parsing without reaching into `@queuert/typed-sql`.
  - New `state-sqlite-bun` example demonstrates `@queuert/sqlite` running on `bun:sqlite`.

  **Breaking:**
  - `createInProcessWorker`: `workerId` option renamed to `workerName` — an optional human-readable label restricted to `/^[A-Za-z0-9._-]+$/`. The runtime always appends a random UUID to produce the final worker id (`${workerName}-${uuid}`, or just `${uuid}` when omitted), making duplicate worker ids impossible to express. Observability events and error fields continue to expose the full id under `workerId`.
  - Validation adapter signatures accept the "single slice or readonly array" shape `createClient` already takes; `ExternalJobTypeDefinitions` is no longer exported (use `JobTypeDefinitions` for a single slice or `JobTypesDefinitions` for either form). Adapter authors implementing `runValidationAdapterConformance` must add a `buildWithExternalSlices` fixture, and `buildWithExternalSlice`'s `blockers` tightens from a readonly array to a tuple — schemas under test must switch from `array(...)` to `tuple([...])` (`z.tuple`, `v.tuple`, `Type.Tuple`, `type([...])`).
  - Public error classes (`JobNotFoundError`, `ChainNotFoundError`, `JobTakenByAnotherWorkerError`, `JobAlreadyCompletedError`, `JobNotTriggerableError`, `WaitChainTimeoutError`) have their contextual fields (`jobId`, `chainTypeName`, etc.) tightened to non-optional `string` / `number`, and constructor options promoted from optional to required — caught errors no longer need null-checks. `JobTakenByAnotherWorkerError.leasedBy` is now `string | null` (an omitted constructor option is normalized to `null`); narrowings via `=== undefined` should switch to `=== null`.
  - `@queuert/otel`: every metric attribute key renamed to OpenTelemetry semantic-convention style (lowercase, dotted) to align with the span attributes already emitted by the tracing layer. Metric _names_ are unchanged, so queries still resolve — but dashboards, alerts, and recording rules that group by or filter on the old keys silently return empty results until updated. `workerId` → `queuert.worker.id`, `typeName` → `queuert.job.type`, `chainTypeName` → `queuert.chain.type`, `continued` → `queuert.job.continued`, `operation` → `queuert.adapter.operation`. Two value encodings also changed on `queuert.job.completed`: `queuert.job.continued` is now a real boolean (not `"true"` / `"false"`), and `queuert.worker.id` is omitted for workerless completions (no longer the literal string `"null"`).
  - `@queuert/postgres` and `@queuert/sqlite`: `executeSql`'s `id` now uniquely identifies the resolved SQL within a provider — the template applier folds variants like `schema` / `tablePrefix` into a hashed suffix. The built-in `pg.Pool` provider drops its SHA1 name-hash (`query.name = id`); built-in `better-sqlite3` and `node:sqlite` providers drop their per-database SQL→Statement maps and key the cache by `id`. Custom providers can do the same.

  **Fixes:**
  - Relax the generic bound on `AttemptMiddleware`'s `TStateAdapter` from `StateAdapter<BaseTxContext, any>` to `StateAdapter<any, any>`. The previous bound was unusable in practice: because the transaction-context type parameter appears in contravariant positions, no concrete adapter with a non-empty `txCtx` could satisfy `StateAdapter<BaseTxContext = {}, any>`. Adapter-aware middleware and generic test helpers now type-check without `any` workarounds.

### Patch Changes

- Updated dependencies
  - queuert@0.13.0

## 0.12.0

### Major Changes

- Restructure registries around composable slices, drop the `Job` prefix from chain naming across the public surface, add adapter `close()` lifecycle, split wake-hint budgets out of `notifyJobScheduled`, run pure-`SELECT` queries concurrently via `AsyncRwLock`, replace dedicated FOR-UPDATE getters with a `lock` option on the existing getters, run transaction-hook `flush`/`discard` concurrently for measurable throughput gains across every adapter, and cache prepared statements via an optional `id` on `TypedSql`. A schema migration `20260430000000_rename_chain_indexes` runs automatically via `migrateToLatest()` (Postgres uses `ALTER INDEX RENAME`; SQLite drops + recreates).

  **Features:**
  - Onion-style `AttemptMiddleware` (`wrapHandler` / `wrapPrepare` / `wrapComplete`) lets middleware wrap each phase of an attempt and inject typed context; chains run per-`Processors` slice instead of worker-wide.
  - Concurrent `SELECT` reads (`AsyncRwLock`) and concurrent transaction-hook flush — end-to-end throughput improves on every adapter (e.g. SQLite better-sqlite3 ~7.2k → ~8.4k jobs/s; Postgres pg notify ~1.5k → ~1.9k jobs/s).
  - Prepared-statement caching: pass `id` to `sql()` to enable per-statement preparation in built-in providers (postgres.js `prepare: true`, pg `query.name`, SQLite `db.prepare` cache).
  - `runValidationAdapterConformance` conformance runner exported from `queuert/conformance` for validation-adapter authors.
  - `UnknownJobTypeError` raised by merged `JobTypes` when a referenced type name isn't owned by any slice.

  **Breaking:**
  - Slice model: `JobTypeRegistry` / `JobTypeProcessorRegistry` → `JobTypes` / `Processors`. `createClient` / `createInProcessWorker` accept a single slice or array of slices; merge helpers (`mergeJobTypeRegistries`, `mergeJobTypeProcessorRegistries`) removed.
  - Middleware: `JobAttemptMiddleware` → `AttemptMiddleware`; lives on the `Processors` slice (`createProcessors({ attemptMiddleware })`).
  - Worker options: `pollIntervalMs` is top-level on `createInProcessWorker`; per-type `backoffConfig` / `leaseConfig` move onto `createProcessors`; the old worker-loop `backoffConfig` is renamed to `recoveryBackoffConfig`.
  - Chain naming: drop `Job` prefix everywhere — types (`Chain`, `ChainStatus`, `ChainNotFoundError`, `ChainData`), client methods (`startChain(s)`, `getChain`, `awaitChain`, `listChains`, `listChainJobs`, `completeChain`, `deleteChain(s)`), notify/observability events, log entry types and messages, and OTEL metrics (`queuert.chain.*`). Drop `ById` suffix on `StateAdapter` getters (`getJob`, `getChain`, `listChains`, `listChainJobs`, `deleteChains`). Filter parameters: `excludeJobChainIds` → `excludeChainIds`, `jobChainId` → `chainId`, `jobChainTypeName` → `chainTypeName`.
  - Adapter lifecycle: `NotifyAdapter` and `StateAdapter` now require an idempotent `close()`. Provider-level `close()` is optional, only on resource-owning providers. `PgPoolNotifyProvider` type removed (`createPgPoolNotifyProvider` returns plain `PgNotifyProvider`).
  - Wake hints: `notifyJobScheduled(typeName)` no longer takes a count. New `provideWakeHint(typeName, count)` and `consumeWakeHint(typeName)` methods, keyed by type name and additive across concurrent publishers.
  - Concurrent reads: `createAsyncLock` / `AsyncLock` → `createAsyncRwLock` / `AsyncRwLock` with `acquireRead()` / `acquireWrite()` returning a `Disposable`-compatible `LockHandle`. `SqliteStateProvider.executeSql` and `PgStateProvider.executeSql` require new `paramTypes` and `readOnly` fields; `params` is no longer optional. Custom SQLite providers must consult `readOnly` to opt into concurrent reads.
  - Lock option replaces FOR UPDATE getters: `getJobForUpdate` and `getLatestChainJobForUpdate` removed. Pass `lock: "exclusive"` to `getJob` / `getChain`. `getChain({ lock: "exclusive" })` now locks only the latest job in the chain.
  - Transaction-hook flush: cross-hook ordering is no longer guaranteed. Custom hooks needing ordering must register under a single key.
  - Cached prepared statements: custom providers see an optional `id?: string` on `executeSql`. Behind transaction-mode poolers (PgBouncer, Supavisor), write a custom provider that ignores `id`.
  - `RescheduleJobError` no longer carries `cause: undefined` when not supplied. `BaseTxContext` exported only from `queuert` (the duplicate from `queuert/internal` is removed).

  **Fixes:**
  - `@queuert/postgres`: `addJobsBlockersSql` now `FOR UPDATE`s the latest job of each blocker chain before inserting blockers, closing a race that could leave a blocked job stuck.

### Patch Changes

- Updated dependencies
  - queuert@0.12.0

## 0.11.0

### Minor Changes

- Promote in-process adapters to the public `queuert` entry (now async), add `queuert/conformance` runner for building and certifying custom adapters, and introduce singular `deleteJobChain` + plural `triggerJobs` client APIs. Add Redis Cluster support (new cluster notify examples), and optional `withSavepoint` hooks on `PgStateProvider` / `SqliteStateProvider` for drivers with native savepoint tracking. New guides and examples for prioritization and error recovery.

  **Breaking:**
  - `runInTransaction` → `withTransaction` (StateAdapter, Pg/Sqlite providers).
  - `HookDef` → `HookDefinition`.
  - `createPgNotifyAdapter` / `createRedisNotifyAdapter`: option `provider` → `notifyProvider`.
  - `createInProcessStateAdapter` / `createInProcessNotifyAdapter` are now async (and moved from `queuert/internal` to `queuert`).
  - `client.deleteJobChain` returns `undefined` for missing chains instead of throwing `JobChainNotFoundError`.
  - `StateAdapter`: `triggerJob` replaced by `triggerJobs`; `deleteJobChains` returns `{ deleted, blockerRefs }`; adapters now enforce blocker validation.
  - Custom `PgStateProvider` / `SqliteStateProvider`: `executeSql` takes `paramTypes` / `columnTypes` (replacing the `returns` flag).
  - `pgLiteral` / `sqliteLiteral` removed from public package entries.
  - `Job<…>` gained a `TOutput` generic parameter.

### Patch Changes

- Updated dependencies
  - queuert@0.11.0

## 0.10.0

### Minor Changes

- - Add `vacuum()` method to Postgres state adapter for on-demand dead-tuple reclamation on job tables. New `vacuum_tuning` migration configures fillfactor and aggressive autovacuum settings to reduce table bloat automatically
  - Add `vacuum()` method to SQLite state adapter for on-demand page reclamation via incremental vacuum. `migrateToLatest()` now validates that `auto_vacuum = INCREMENTAL` is set on the database
  - Fix NATS notification buffering: flush the connection after each publish to ensure timely delivery
  - Relax `@opentelemetry/api` peer dependency from `^1.9.0` to `^0.14.0`

### Patch Changes

- Updated dependencies
  - queuert@0.10.0

## 0.9.5

### Patch Changes

- - Add `excludeJobChainIds` option to deduplication, allowing callers to skip specific chains during deduplication matching
  - Improve Client type covariance: `Client<A | B>` is now assignable to `Client<A>`
  - Add compile-time validation that `createJobTypeProcessorRegistry` receives a client with all required job types
  - Export `BaseTxContext`, `HookDef`, and `TransactionHooksSavepoint` from the public API
  - Add cascade delete option for job chains in the dashboard UI and API
  - BREAKING: `createDashboard` is now async and must be awaited
- Updated dependencies
  - queuert@0.9.5

## 0.9.4

### Patch Changes

- Mutating client methods (`startJobChain`, `startJobChains`, `deleteJobChains`, `triggerJob`, `completeJobChain`) now enforce that a transaction context from `runInTransaction` is provided at runtime, throwing `TransactionContextRequiredError` if omitted. This matches the existing TypeScript type requirements and ensures consistent behavior for JavaScript callers.
- Updated dependencies
  - queuert@0.9.4

## 0.9.3

### Patch Changes

- Simplified `JobAttemptMiddleware` type signature — the second type parameter (`TJobTypeDefinitions`) has been removed from `JobAttemptMiddleware` and `JobTypeProcessorDefaults`. Middleware definitions are now simpler: use `JobAttemptMiddleware<typeof stateAdapter>` instead of `JobAttemptMiddleware<typeof stateAdapter, JobTypeRegistryDefinitions<typeof registry>>`. Additionally, `ResolvedJobChain` now correctly excludes `undefined` from the output type of intermediate chain steps.
- Updated dependencies
  - queuert@0.9.3

## 0.9.2

### Patch Changes

- Fix broken package exports in published npm packages
- Updated dependencies
  - queuert@0.9.2

## 0.9.1

### Patch Changes

- Fix broken package exports in published npm packages
- Updated dependencies
  - queuert@0.9.1

## 0.9.0

### Minor Changes

- ### Features
  - Error messages stored for failed jobs now include the full stack trace and custom Error properties instead of just `[object Object]` or a bare message string.
  - New observability events `jobChainDeleted` and `jobTriggered` are emitted through logging, OTel, and custom observability adapters.
  - `triggerJob` now guards against non-pending jobs and uses row-level locking to prevent race conditions.

  ### Breaking changes
  - The Postgres adapter default schema is now `"public"` with table prefix `"queuert_"` (previously `"queuert"` schema with no prefix). Pass `{ schema: "queuert", tablePrefix: "" }` to `createPgStateAdapter` to preserve existing behavior.
  - Several internal type exports have been removed: `NavigationMap`, `BaseNavigationMap`, `BaseNavigationEntry`, `JobTypeRegistryNavigation`, `ChainJobTypeNames`, `ContinuationJobTypes`, `EntryJobTypeDefinitions`, `BlockedJobTypeNames`, `ChainTypesReaching`, `JobTypeProcessorRegistryNavigation`, `processorNavigationSymbol`. Use `JobTypeNames`, `JobTypeEntryNames`, and `JobTypeProperty` as replacements where applicable.
  - Merged registry definitions are now a union type instead of an intersection.

### Patch Changes

- Updated dependencies
  - queuert@0.9.0

## 0.8.1

### Patch Changes

- ### Dashboard
  - Fixed job detail continuation lookup to use a targeted query instead of fetching the entire chain, significantly improving performance for long chains.
  - Fixed a race condition where changing filters while a "load more" request was in-flight could append stale results in the chain and job list views.
  - The `leasedBy` badge in the job list now only appears for running jobs.
  - Fixed TypeScript type inference for `createDashboard` — the `client` option now preserves generic types instead of requiring `Client<any, any>`.

- Updated dependencies
  - queuert@0.8.1

## 0.8.0

### Minor Changes

- **Breaking changes:**
  - Renamed worker and client options for clarity: `registry` is now `jobTypeRegistry`, `processorRegistry` is now `jobTypeProcessorRegistry`, `processDefaults` is now `jobTypeProcessorDefaults`. The `InProcessWorkerProcessDefaults` type is now `JobTypeProcessorDefaults`. `mergeJobTypeRegistries` and `mergeJobTypeProcessorRegistries` now take `{ slices: [...] }`.
  - The `Job` type now has a 5th type parameter `TOutput`. Completed jobs expose an `output` field.
  - Dashboard now takes a `Client` instance instead of raw adapters.

  **New features:**
  - `triggerJob` client method: trigger a pending job immediately, bypassing its scheduled time.
  - `listJobs` now supports a `jobChainTypeName` filter to query jobs by their chain's type.
  - `createJobTypeProcessorRegistry` rejects merged registries at runtime with a clear error message.

  **Bug fixes:**
  - `continueWith` now uses distributive conditional types for correct type checking across union job types.
  - `completeJobChain` rejects un-narrowed union jobs, preventing ambiguous completions.

  **Dashboard:**
  - Chain deletion with confirmation dialog.
  - "Trigger" button for pending jobs.
  - Dashboard now uses the Client API internally with seroval serialization, preserving Date objects in the UI.

### Patch Changes

- Updated dependencies
  - queuert@0.8.0

## 0.7.0

### Minor Changes

- - Add savepoint support to `TransactionHooks` for automatic rollback of buffered side effects. New methods: `withSavepoint(fn)` and `createSavepoint()`. Hook definitions can now provide a `checkpoint` callback.
  - Fix: lease renewal now only runs in staged mode, avoiding unnecessary work in atomic/deferred modes.
  - Fix: error handler properly rolls back transactions on inner failure, preventing inconsistent job state.
  - Fix: default `TJobId` type corrected from `string` to `UUID` on built-in adapters.
  - `StateAdapter.withSavepoint` is now required with simplified positional signature.
  - `HookDef` and `TransactionHooksSavepoint` types are now exported.

### Patch Changes

- Updated dependencies
  - queuert@0.7.0

## 0.6.0

### Minor Changes

- **New: Batch `startJobChains` API** — Create multiple job chains in a single operation with type-safe returns and optimized DB round-trips.

  **New: Savepoint-protected user callbacks** — `prepare` and `complete` callbacks run inside savepoints on PostgreSQL, preventing transaction poisoning. Custom adapters can opt in via `withSavepoint`.

  **Breaking: StateAdapter interface updated** — `createJob`/`addJobBlockers` replaced by batched `createJobs`/`addJobsBlockers`.

  **Breaking: Removed type exports** — `CompleteJobChainResult` and `JobChainCompleteOptions` are now internal.

### Patch Changes

- Updated dependencies
  - queuert@0.6.0

## 0.5.1

### Patch Changes

- Add compile-time validation for job type definitions and processor registries. Validation adapters now surface definition errors (missing output schemas, invalid blocker references, unknown type names) as TypeScript errors instead of accepting them silently. `createInProcessWorker` rejects processor registries containing job types unknown to the client at compile time. New exported types: `ValidatedJobTypeDefinitions`, `JobTypeDefinitionErrors`.
- Updated dependencies
  - queuert@0.5.1

## 0.5.0

### Minor Changes

- **Renamed core APIs for consistency**: `defineJobTypes` is now `defineJobTypeRegistry`, processor registries use `createJobTypeProcessorRegistry`, and `createInProcessWorker` accepts `processorRegistry`. `mergeJobTypeProcessors` is now `mergeJobTypeProcessorRegistries`.

  **`continueWith` restricted to local types**: `continueWith` targets now validate against local job type definitions only. Blockers remain validated against the full set (local + external).

  **Faster type checking**: Navigation types rewritten in tail-recursive form with precomputed maps, reducing type instantiations by up to 86% in blocker-heavy scenarios.

### Patch Changes

- Updated dependencies
  - queuert@0.5.0

## 0.4.0

### Minor Changes

- Add feature slices with `mergeJobTypeRegistries` and `mergeJobTypeProcessors`

  Split job type definitions and processors into independent feature modules (slices), then merge them at the application level. Duplicate job types are detected at both compile time and runtime.

  `defineJobTypes` now accepts an optional `TExternal` type parameter for compile-time validation of cross-slice blocker and continueWith references.

  Other changes:
  - Trace context types narrowed from `unknown` to `string | null` across `ObservabilityAdapter`, `StateAdapter`, and all storage backends. Postgres trace columns changed from `jsonb` to `text` (migration required).
  - Navigation utility types renamed for clarity: `JobOf` -> `ResolvedJob`, `JobChainOf` -> `ResolvedJobChain`, `ChainJobTypes` -> `ChainJobTypeNames`, and others.
  - Handler/callback types renamed: `AttemptHandlerFn` -> `AttemptHandler`, `PrepareFn` -> `AttemptPrepare`, `CompleteFn` -> `AttemptComplete`, `CompleteCallbackOptions` -> `AttemptCompleteOptions`, `PrepareConfig` -> `AttemptPrepareOptions`.
  - Registry phantom property replaced with symbol; use `JobTypeRegistryDefinitions<T>` utility type. `PartialJobTypeReference` replaced by `JobTypeReference` union.
  - `JobTypeRegistryConfig` now requires `getTypeNames` callback.

### Patch Changes

- Updated dependencies
  - queuert@0.4.0

## 0.3.2

### Patch Changes

- Replace the per-request CSP `nonce` option with a new `basePath` option on `createDashboard()`. Set `basePath` to your mount prefix when serving the dashboard at a sub-path. The `fetch` handler no longer accepts a second argument. The frontend now derives its base URL from the `<base>` tag, making sub-path routing and asset loading reliable across reverse-proxy setups.
- Updated dependencies
  - queuert@0.3.2

## 0.3.1

### Patch Changes

- Fix dashboard sub-path asset loading and CSP nonce support. Update documentation with API reference section.
- Updated dependencies
  - queuert@0.3.1

## 0.3.0

### Minor Changes

- ### Breaking Changes
  - Redesigned worker to use parallel slot-based execution model
  - Simplified API naming by removing redundant `Queuert` prefix (`createClient`, `createInProcessWorker`)
  - Simplified worker config API by reducing property verbosity
  - Renamed deduplication API from strategy to scope
  - Replaced `withNotify` with `CommitHooks` for explicit side-effect buffering
  - Renamed `CommitHooks` to `TransactionHooks` and added discard support
  - Accept client instance in `createInProcessWorker` instead of individual adapters
  - Replaced `startBlockers` callback with `blockers` array
  - Removed `originId` from job model, use deduplication key for continuations
  - Removed `rootChainId` from job model, unified chain deletion
  - Removed `updatedAt` from `StateJob` and database schema
  - Removed state adapter retry wrapper
  - Split trace context into separate chain and job fields
  - Moved blockers from `Job` base type to separate `JobWithBlockers` wrapper
  - Renamed `waitForJobChainCompletion` to `awaitJobChain`
  - Renamed state adapter methods for clarity and consistency
  - Improved error classes and client API consistency
  - Added `chain_index` for deterministic chain ordering and continuation dedup
  - Changed `deleteJobChains` to return deleted chains
  - Added distributed tracing to `ObservabilityAdapter`
  - Hardcoded `queuert` metric prefix and removed messaging semantic convention attributes in OTEL adapter
  - Cleaned up type exports and renamed reference types

  ### New Features
  - **Dashboard**: New `@queuert/dashboard` package with job and chain listing UI
  - **Client query API**: Pagination and type narrowing for `queryJobs` and `queryJobChains`
  - **Distributed tracing**: OTEL blocker spans with trace context persistence across job chains
  - **Cascade deletion**: `cascade` option on `deleteJobChains` for transitive dependency deletion
  - **`awaitJobChain`**: Await chain completion with configurable polling
  - **Table prefix**: PostgreSQL adapter `tablePrefix` configuration option
  - **Migration tracking**: Migration version tracking for PostgreSQL and SQLite adapters
  - **Transaction hooks**: `createTransactionHooks` for manual flush/discard lifecycle
  - **Documentation site**: Astro-based docs with TSDoc API reference generation

  ### Improvements
  - Parallel slot-based worker execution for better throughput
  - Workers only subscribe to job notifications when idle slots are available
  - Buffered observability events via transaction hooks
  - State and notify adapter conformance test suites for adapter authors
  - Comprehensive examples: query, chain-awaiting, chain-deletion, blockers, error-handling, timeouts, workerless, scheduling, deduplication, processing modes, NATS, multi-worker, ArkType validation, memory footprint benchmark
  - Shared TypeScript configuration via `@queuert/tsconfig` package
  - Redesigned dashboard to use standard Web APIs instead of Hono

  ### Bug Fixes
  - Fixed workers reaping their own in-progress jobs with concurrent slots
  - Scoped deduplication key by chain type name
  - Fixed context leakage to independent chains during job processing
  - Fixed orphaned timers blocking process exit
  - Removed notification listeners before releasing PostgreSQL pool client
  - Only subscribe to job notifications when worker has idle slots
  - Added NOT NULL constraint to `chain_id` column in PostgreSQL and SQLite schemas

### Patch Changes

- Updated dependencies
  - queuert@0.3.0

## 0.2.0

### Minor Changes

- ### Breaking Changes
  - Split `createQueuert` into `createQueuertClient` and `createQueuertInProcessWorker` for clearer separation of concerns
  - Simplified adapter API by removing `provideContext` and making `txContext` optional
  - Changed Log API from tuple args to named `data`/`error` properties
  - Renamed `JobSequence` to `JobChain` across the entire API
  - Simplified `migrateToLatest` API and removed nested transaction support

  ### New Features
  - **ObservabilityAdapter**: OpenTelemetry integration with histogram metrics for duration tracking and gauge metrics for worker state
  - **JobTypeRegistry**: Compile-time and runtime validation with support for Zod, Valibot, and TypeBox
  - **NATS adapter**: New `@queuert/nats` notify adapter with optional JetStream KV
  - **Job attempt middlewares**: Support for contextual logging during job processing
  - **Deferred scheduling**: Schedule jobs for future execution via `schedule` option
  - **Thundering herd optimization**: Hint-based notification system reduces unnecessary polling

  ### Improvements
  - Single-statement migrations for cleaner provider implementations
  - Restructured documentation into modular design docs
  - Reorganized examples to single-purpose design with clear naming conventions
  - Relaxed peer dependency version constraints

  ### Bug Fixes
  - Prevent context leakage to independent chains during job processing
  - Fix orphaned timers blocking process exit
  - Correct type extraction for dual-context adapters

### Patch Changes

- Updated dependencies
  - queuert@0.2.0

## 0.1.2

### Patch Changes

- Add comprehensive README documentation
- Updated dependencies
  - queuert@0.1.2

## 0.1.1

### Patch Changes

- Add OIDC trusted publishing support for npm
- Updated dependencies
  - queuert@0.1.1

## 0.1.0

### Minor Changes

- Initial release
