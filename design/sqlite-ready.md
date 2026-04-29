# SQLite production-readiness

Bring `@queuert/sqlite` from "works in single-process tests" to "deployable on a real machine with multiple workers." Addresses the SQLite epic in [TODO.md](../TODO.md).

## Problem

The SQLite adapter today is correct under a single-process, single-connection assumption. Several things break or become awkward when users actually try to run it in production:

1. **Concurrency model is unrealistic.** The adapter ships with an in-process `createAsyncRwLock()` to serialize writes against a single shared `better-sqlite3` / `node:sqlite` connection. Every example wires this lock into both `withTransaction` and any user-initiated transaction on the same connection. This is correct for the test fixtures but is not how anyone runs SQLite in production — production deployments use file DBs in WAL mode with `busy_timeout` and either connection-per-transaction or a small pool.
2. **`createAsyncRwLock` is being prescribed as the extension contract.** [sqlite-internals.md:126](../docs/src/content/docs/advanced/sqlite-internals.md#L126) tells custom provider implementers they "must use `createAsyncRwLock()`". `createAsyncRwLock` is re-exported from [packages/sqlite/src/index.ts:6](../packages/sqlite/src/index.ts#L6), which signals it's part of the supported extension surface. It isn't — the actual provider contract is just "`withTransaction` gives exclusive atomic access." The lock is one strategy for satisfying that contract on a shared single connection. Other strategies (a writer pool of size 1, connection-per-tx, ORM-native transactions) satisfy it just as well, and may be preferable. Users who copy the prescribed pattern get boilerplate they have to maintain — and get wrong: the better-sqlite3 example splits the lock across instances, the kysely example omits the lock on the user-side `db.transaction()` call entirely (latent race).
3. **Per-job round-trips on hot write paths.** `createJobs` loops per-job, issuing `findExistingContinuationSql` and `findDeduplicatedJobSql` ([state-adapter.sqlite.ts:339](../packages/sqlite/src/state-adapter/state-adapter.sqlite.ts#L339), [:357](../packages/sqlite/src/state-adapter/state-adapter.sqlite.ts#L357)) one job at a time. `addJobsBlockers` runs 3–4 sequential queries per blocker entry ([state-adapter.sqlite.ts:423](../packages/sqlite/src/state-adapter/state-adapter.sqlite.ts#L423)). For a chain with N jobs or a job with N blockers, that's O(N) round-trips inside an exclusive write transaction — the worst place to be slow under SQLite's single-writer model.
4. **No multi-worker example.** PostgreSQL has `state-postgres-multi-worker` showing how to run multiple workers against one DB. SQLite doesn't, so users have to figure out for themselves whether (and how) it's possible.
5. **Small correctness/cleanup items.** `PRAGMA foreign_keys = ON` is required for the `job_blocker.blocked_by_chain_id` FK but not validated at adapter init by default (only when the user opts into `checkForeignKeys` in `migrateToLatest`). The resilience test suite carries a `skipConcurrencyTests` flag that exists only to skip a subset of cases under SQLite.

## Proposed

Four workstreams. Order matters for the docs/examples work — the concurrency story has to land before the multi-worker example reads as production guidance.

### 1. Concurrency model

Treat WAL + connection-per-transaction (or a small pool) as the recommended SQLite production setup. Update the adapter, examples, and docs to reflect this, and stop prescribing `createAsyncRwLock`.

- **Adapter**: add busy-timeout / retry handling around `SQLITE_BUSY` so a short writer contention doesn't fail an operation. Default `busy_timeout` to a sensible value (e.g. 5s) that users can override. Investigate whether the adapter should manage a write pool of size 1 plus a read pool internally, or whether the provider continues to own connection management.
- **Provider contract**: `SqliteStateProvider.withTransaction` gives exclusive atomic access. _How_ a provider achieves that — connection-per-tx, single-writer pool, ORM-native transaction — is the provider author's choice. Document the contract; do not prescribe one strategy.
- **Operation-level locking via `lock: "exclusive"`** _(landed)_. State adapter `getJobById` / `getJobChainById` accept `lock: "exclusive"` to acquire write-intent on the row(s) the caller is about to extend. On Postgres this maps to `FOR UPDATE`. On SQLite the bundled adapter issues a no-op `UPDATE ... SET id = id RETURNING *` (and a sibling statement for the latest job in a chain) which promotes the deferred transaction to RESERVED, blocking other writers until commit. This makes the lock contract meaningful at the operation level rather than relying on tx-scope serialization, which is what the WAL+pool world will need.
- **`BEGIN` (DEFERRED) instead of `BEGIN IMMEDIATE`** _(landed)_. The bundled providers, the example providers, the example `index.ts` user-managed-tx demos, and the conformance specs now all start transactions with plain `BEGIN`. Combined with the operation-level locking above, transactions promote to RESERVED only when actually needed (`createJobs`, `acquireJob`, `lock: "exclusive"` reads, etc.), instead of locking the database the moment `withTransaction` is entered. Under the current single-connection + `acquireWrite()` rwlock, every transaction still serializes JS-side, so this is a no-op for today's tests; it becomes load-bearing once the rwlock is dropped for pooled WAL connections.
- **User-managed transaction contract** _(deferred)_. The original plan was to require user-managed transactions sharing a `txCtx` with queuert mutating methods to use `BEGIN IMMEDIATE`, so the upgrade-to-RESERVED can't fail mid-transaction with `SQLITE_BUSY_SNAPSHOT` after wasted reads. With operation-level `lock: "exclusive"` now landed, that recommendation becomes specific to the WAL+pool deployment story — under single-connection (today's examples and tests) there is no contention to fail on, so we don't need to prescribe it anywhere yet. Re-introduce the recommendation alongside the multi-worker WAL example.
- **Stop re-exporting `createAsyncRwLock`**. Drop the export from `@queuert/sqlite`'s public surface (or move it under an `internal` namespace). The lock is an internal helper for the bundled providers, not part of the extension API.
- **Soften the docs prescription**. Rewrite the AsyncRwLock section in [sqlite-internals.md](../docs/src/content/docs/advanced/sqlite-internals.md) to describe the contract first, then list strategies (lock + shared connection, connection-per-tx, pool) with their tradeoffs. Remove the "must use `createAsyncRwLock()`" line.

### 2. Batched writes

Reduce the per-job and per-blocker round-trips on the hot write paths. Both transactions hold the SQLite write lock while looping; cutting round-trips directly cuts contention.

- **`createJobs`**: rewrite `findExistingContinuationSql` / `findDeduplicatedJobSql` to take an array of candidate keys and return all matches in one query. Restructure the JS loop to do one batched lookup, then partition jobs into "skip / continue / insert" buckets, then one batched insert.
- **`addJobsBlockers`**: collapse the 3–4 sequential queries per blocker into batched equivalents. Goal is O(1) round-trips per call regardless of blocker count.
- Both changes should mirror the structural shape of the PostgreSQL adapter where reasonable, since the same logical batching applies (the difference is just SQLite's lack of writeable CTEs with RETURNING — handle that with multiple batched statements inside one transaction).

### 3. Examples & multi-worker

Rewrite the bundled SQLite examples to demonstrate production patterns and add the missing multi-worker example.

- **Rewrite existing examples** (`state-sqlite-better-sqlite3`, `state-sqlite-node`, `state-sqlite-kysely`, `state-sqlite-drizzle`, `state-sqlite-prisma`) to:
  - Use a file-backed DB (not `:memory:`)
  - Set `journal_mode=WAL` and `busy_timeout`
  - Use connection-per-transaction or a small pool, not a shared connection + lock
  - Drop `createAsyncRwLock` from user-facing code
  - Update each example's README to describe the pattern shown
- **Add `example-state-sqlite-multi-worker`**: mirror of `state-postgres-multi-worker`, showing two or more worker processes against a shared file-backed WAL database. This is the proof that SQLite production deployment works.

### 4. Cleanup

- **Validate `PRAGMA foreign_keys = ON` at adapter init by default.** Currently gated behind the `checkForeignKeys` option on `migrateToLatest`. The FK on `job_blocker.blocked_by_chain_id` requires it; failing fast at init is better than silently corrupting blocker state later.
- **Drop `skipConcurrencyTests` from the resilience suite.** Move SQLite-skipped concurrency tests to a separate suite that's only run for adapters that support concurrent writers (so SQLite simply doesn't opt in), instead of carrying a per-case flag.

## What changes in `sqlite-internals.md`

- Replace the "AsyncRwLock" section with a "Concurrency strategies" section that:
  - States the contract: `withTransaction` gives exclusive atomic access.
  - Lists the strategies (single-connection + lock; connection-per-tx; small pool with single writer + multiple readers) with when each fits.
  - Notes that the bundled providers use `createAsyncRwLock` internally, but custom providers don't have to.
- Remove the "Custom `SqliteStateProvider` implementations must use `createAsyncRwLock()`" line.
- Add a "WAL mode and busy_timeout" subsection covering recommended defaults.
- _(deferred until the multi-worker example lands)_ Document that user-managed transactions sharing a `txCtx` with queuert mutating methods on a WAL+pool deployment should use `BEGIN IMMEDIATE` to fail cleanly at `BEGIN` instead of mid-transaction with `SQLITE_BUSY_SNAPSHOT`. Not relevant for the current single-connection examples.

## Migration

Most of this is non-breaking:

- Batched writes: internal refactor, no API change.
- Adapter `busy_timeout` default: new option, defaults are additive.
- Cleanup items: internal.

Breaking pieces:

- Removing the `createAsyncRwLock` re-export from `@queuert/sqlite` is breaking for users who imported it. Mitigations: (a) keep it exported but mark deprecated for one major; (b) document the alternatives so users can migrate; (c) provide the underlying primitive somewhere else if it's genuinely useful (it probably isn't outside this codebase).
- Examples changing means anyone copy-pasting the old patterns onto an existing app sees a different shape next time they upgrade. Acceptable — examples are not API.

## Open questions

- **Should the adapter manage a read/write pool internally, or stay provider-driven?** Provider-driven keeps the adapter small and lets users plug their existing pool. Adapter-managed is more turnkey. Lean provider-driven, with a `createPooledSqliteStateProvider` helper for users who want batteries included.
- **What's the right `busy_timeout` default?** 5s is a common choice. Needs to interact cleanly with worker poll intervals — too low and writers fail under contention, too high and a stuck writer wedges throughput.
- **Does removing `createAsyncRwLock` from the public surface need a deprecation period?** It's plausibly used by zero non-internal consumers, but we don't know. Default to one-major deprecation unless we're confident it's unused.
- **Multi-worker example: same process or separate processes?** Separate processes is more realistic for SQLite (concurrency story is OS-level file locking, not in-process) and matches the PostgreSQL example's spirit. Separate processes preferred.

## Implementation order

1. Concurrency: `busy_timeout` defaults, retry/contention handling, document the contract.
2. Drop `createAsyncRwLock` prescription from docs; deprecate the public re-export.
3. Batched `createJobs` and `addJobsBlockers`.
4. Rewrite existing SQLite examples to production patterns.
5. Add `example-state-sqlite-multi-worker`.
6. `PRAGMA foreign_keys` init validation.
7. Resilience suite split (drop `skipConcurrencyTests`).
